package superplot

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"unicode"
)

// Geographies: the region boundaries a map joins data to. Mirrors packages/core/src/geo/geography.ts.
//
// Super Plot ships no boundaries. The host imports the dataset it has chosen with RegisterGeography, or a spec
// carries a small one inline. Input is GeoJSON (a FeatureCollection) or TopoJSON (a Topology), longitude and
// latitude in degrees. Only Polygon and MultiPolygon features become regions.
//
// A port validates and describes; it does not draw. So the rings are checked (and counted against the limits) but
// not kept: a region here is its key, its name and whether the source data marks it as disputed.

// GeoPick reads one value (the join key, the display name, the disputed flag) from a feature.
type GeoPick func(properties map[string]any, id any) any

// GeoProperty picks the feature property with this name.
func GeoProperty(name string) GeoPick {
	return func(p map[string]any, _ any) any { return p[name] }
}

// GeographyOptions says how to read a boundary file. The zero value reads the defaults.
type GeographyOptions struct {
	// Object is the TopoJSON object to read (default: the first).
	Object string
	// Key gives the join key. Default: the feature id, then properties.id, then properties.name.
	Key GeoPick
	// Name gives the display name. Default: properties.name, else the key.
	Name GeoPick
	// Disputed marks a region as disputed in the source data. Default: properties.disputed == true.
	Disputed GeoPick
	// Aliases are extra spellings that should match a region: alias -> key.
	Aliases map[string]string
	// Attribution is the credit line of the dataset.
	Attribution string
}

// GeoPresets says where common open boundary datasets keep their join key and name. Templates only: download the
// file yourself (check its licence and its stance on disputed areas), then RegisterGeography(name, data, preset).
//
//	natural-earth-admin0  Natural Earth admin-0 countries (public domain); pick the "point of view" edition you need
//	natural-earth-admin1  Natural Earth admin-1 states and provinces (public domain)
//	world-atlas           the world-atlas TopoJSON files; ids are ISO 3166-1 numeric codes
//	geoboundaries         geoBoundaries (CC BY 4.0, cite it)
var GeoPresets = map[string]GeographyOptions{
	"natural-earth-admin0": {
		Key: func(p map[string]any, _ any) any {
			if s, ok := p["ISO_A3"].(string); ok && s != "-99" {
				return s
			}
			return p["ADM0_A3"]
		},
		Name: func(p map[string]any, _ any) any { return nullish(p["NAME"], p["ADMIN"]) },
		Disputed: func(p map[string]any, _ any) any {
			s, ok := p["TYPE"].(string)
			return ok && disputedRe.MatchString(s)
		},
	},
	"natural-earth-admin1": {
		Key:  func(p map[string]any, _ any) any { return nullish(p["iso_3166_2"], p["adm1_code"]) },
		Name: GeoProperty("name"),
	},
	"world-atlas": {
		Object: "countries",
		Key:    func(_ map[string]any, id any) any { return id },
		Name:   GeoProperty("name"),
	},
	"geoboundaries": {
		Key: func(p map[string]any, _ any) any {
			for _, k := range []string{"shapeISO", "shapeGroup"} {
				if jsTruthy(p[k]) {
					return p[k]
				}
			}
			return p["shapeID"]
		},
		Name:        GeoProperty("shapeName"),
		Attribution: "geoBoundaries",
	},
}

var (
	disputedRe = regexp.MustCompile(`(?i)disputed|indeterminate`)
	geoNameRe  = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\z`)
	indexRe    = regexp.MustCompile(`^(?:0|[1-9][0-9]{0,9})\z`)
)

// nullish is a ?? b.
func nullish(a, b any) any {
	if a != nil {
		return a
	}
	return b
}

// jsTruthy is JavaScript truthiness of a JSON value (empty arrays and objects are truthy).
func jsTruthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case float64:
		return x != 0 && !math.IsNaN(x)
	case string:
		return x != ""
	}
	return true
}

type geoRegion struct {
	key, name string
	disputed  bool
}

type geography struct {
	name        string
	regions     []geoRegion       // in file order
	lookup      map[string]string // normalised key, name or alias -> region key
	byKey       map[string]int
	vertices    int
	attribution string
}

var (
	geoMu       sync.RWMutex
	geoRegistry = map[string]*geography{}
	geoOrder    []string // registration order
)

// GeographyError carries every issue of unusable boundaries.
type GeographyError struct{ Issues []Issue }

func (e *GeographyError) Error() string {
	var parts []string
	for _, i := range e.Issues {
		if i.Severity != "error" {
			continue
		}
		s := i.Path + ": " + i.Message
		if i.Hint != "" {
			s += " " + i.Hint
		}
		parts = append(parts, s)
	}
	if len(parts) == 0 {
		return "Invalid geography"
	}
	return strings.Join(parts, "\n")
}

// RegisterGeography makes a geography available to specs by name ("geo": "<name>"). data is GeoJSON or TopoJSON:
// JSON text (a string or bytes), or a decoded value. It returns a *GeographyError when the data is unusable, and
// the warnings (skipped features, duplicate keys) otherwise.
//
// The first object of a TopoJSON file is the first in the text; a decoded Go map has no order, so its first
// object is the first in sorted order. Set Object to choose.
func RegisterGeography(name string, data any, opts ...GeographyOptions) ([]Issue, error) {
	if !geoNameRe.MatchString(name) {
		return nil, &GeographyError{[]Issue{{Severity: "error", Code: "bad_value", Path: "name", Message: fmt.Sprintf(`Geography name must be 1-64 letters, digits, ".", "_" or "-", got %q.`, name)}}}
	}
	var o GeographyOptions
	if len(opts) > 0 {
		o = opts[0]
	}
	doc, err := toJSON(data)
	var input any
	if err == nil {
		err = json.Unmarshal(doc, &input)
	}
	if err != nil {
		return nil, &GeographyError{[]Issue{{Severity: "error", Code: "invalid_json", Path: "data", Message: fmt.Sprintf("Geography is not valid JSON: %v.", err)}}}
	}
	var issues []Issue
	geo := readGeography(input, o, &issues, "data", name, func() []string { return keyOrder(doc, "objects") })
	if geo == nil || anyError(issues) {
		return nil, &GeographyError{issues}
	}
	geoMu.Lock()
	if _, ok := geoRegistry[name]; !ok {
		geoOrder = append(geoOrder, name)
	}
	geoRegistry[name] = geo
	geoMu.Unlock()
	return issues, nil
}

// UnregisterGeography forgets a geography; it reports whether the name was registered.
func UnregisterGeography(name string) bool {
	geoMu.Lock()
	defer geoMu.Unlock()
	if _, ok := geoRegistry[name]; !ok {
		return false
	}
	delete(geoRegistry, name)
	for i, n := range geoOrder {
		if n == name {
			geoOrder = append(geoOrder[:i], geoOrder[i+1:]...)
			break
		}
	}
	return true
}

// Geographies lists the registered geography names, in registration order.
func Geographies() []string {
	geoMu.RLock()
	defer geoMu.RUnlock()
	return append([]string(nil), geoOrder...)
}

func anyError(issues []Issue) bool {
	for _, i := range issues {
		if i.Severity == "error" {
			return true
		}
	}
	return false
}

// toJSON is the JSON text of whatever the caller passed (a JSON string, bytes, a map, a struct).
func toJSON(input any) ([]byte, error) {
	switch x := input.(type) {
	case string:
		return []byte(x), nil
	case []byte:
		return x, nil
	}
	return json.Marshal(input)
}

// keyOrder returns the keys of the object at path inside the JSON document, in Object.keys order: array-index
// keys first, ascending, then the rest as written. encoding/json decodes objects into maps, which forget it.
func keyOrder(doc []byte, path ...string) []string {
	dec := json.NewDecoder(bytes.NewReader(doc))
	if t, err := dec.Token(); err != nil || t != json.Delim('{') {
		return nil
	}
	var keys []string
	var sub json.RawMessage
	seen := map[string]bool{}
	for dec.More() {
		t, err := dec.Token()
		k, isKey := t.(string)
		var raw json.RawMessage
		if err != nil || !isKey || dec.Decode(&raw) != nil {
			return nil
		}
		if !seen[k] {
			seen[k] = true
			keys = append(keys, k)
		}
		if len(path) > 0 && k == path[0] {
			sub = raw // the last duplicate wins, as in JSON.parse
		}
	}
	if len(path) > 0 {
		if sub == nil {
			return nil
		}
		return keyOrder(sub, path[1:]...)
	}
	isIndex := func(k string) (uint64, bool) {
		if !indexRe.MatchString(k) {
			return 0, false
		}
		n, err := strconv.ParseUint(k, 10, 64)
		return n, err == nil && n < 4294967295
	}
	sort.SliceStable(keys, func(i, j int) bool {
		a, aOK := isIndex(keys[i])
		b, bOK := isIndex(keys[j])
		if aOK && bOK {
			return a < b
		}
		return aOK && !bOK
	})
	return keys
}

// --- joining ----------------------------------------------------------------------------------------------

func isJSSpace(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', 0x00a0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
		return true
	}
	return r >= 0x2000 && r <= 0x200a
}

func isCased(r rune) bool { return unicode.IsUpper(r) || unicode.IsLower(r) || unicode.IsTitle(r) }

func isCaseIgnorable(r rune) bool {
	switch r {
	case '\'', '.', ':', '^', '`', 0x00a8, 0x00ad, 0x00af, 0x00b4, 0x00b7, 0x00b8, 0x2018, 0x2019, 0x2024, 0x2027:
		return true
	}
	return unicode.In(r, unicode.Mn, unicode.Me, unicode.Cf, unicode.Lm, unicode.Sk)
}

// jsLower is String.prototype.toLowerCase. Go lowers rune by rune; JavaScript also applies the two special
// cases of Unicode's SpecialCasing: a capital sigma at the end of a word, and the dotted capital I.
func jsLower(s string) string {
	if !strings.ContainsAny(s, "Σİ") {
		return strings.ToLower(s)
	}
	rs := []rune(s)
	var b strings.Builder
	for i, r := range rs {
		switch r {
		case 0x0130:
			b.WriteString("i̇")
		case 0x03a3:
			before, after := false, false
			for j := i - 1; j >= 0; j-- {
				if !isCaseIgnorable(rs[j]) {
					before = isCased(rs[j])
					break
				}
			}
			for j := i + 1; j < len(rs); j++ {
				if !isCaseIgnorable(rs[j]) {
					after = isCased(rs[j])
					break
				}
			}
			if before && !after {
				b.WriteRune(0x03c2)
			} else {
				b.WriteRune(0x03c3)
			}
		default:
			b.WriteRune(unicode.ToLower(r))
		}
	}
	return b.String()
}

// normalizeRegion is the join form of a region value: trimmed, lower case, inner white space collapsed.
func normalizeRegion(v any) string {
	var b strings.Builder
	space := false
	for _, r := range jsTrim(orEmpty(v)) {
		if isJSSpace(r) {
			space = true
			continue
		}
		if space {
			b.WriteByte(' ')
			space = false
		}
		b.WriteRune(r)
	}
	return jsLower(b.String())
}

// --- reading ----------------------------------------------------------------------------------------------

type geoReader struct {
	issues *[]Issue
	errors int
	path   string
}

func (rd *geoReader) report(severity, code, path, message string, hint ...string) {
	// Once the error limit is reached nothing more is recorded, warnings included.
	if rd.errors >= data.GeoLimits["maxIssues"] {
		return
	}
	if severity == "error" {
		rd.errors++
	}
	add(rd.issues, severity, code, path, message, hint...)
}

type rawFeature struct {
	id         any
	properties map[string]any
	polygons   int // polygons with at least one ring
	vertices   int
	path       string
}

func finite(v any) (float64, bool) {
	f, ok := v.(float64)
	return f, ok && isFinite(f)
}

// position reads [x, y, ...] with two finite numbers.
func position(v any) (float64, float64, bool) {
	p, ok := v.([]any)
	if !ok || len(p) < 2 {
		return 0, 0, false
	}
	x, xOK := finite(p[0])
	y, yOK := finite(p[1])
	return x, y, xOK && yOK
}

func asLabel(v any) (string, bool) {
	switch x := v.(type) {
	case string:
		if t := jsTrim(x); t != "" {
			return uslice(t, data.GeoLimits["maxNameLength"]), true
		}
	case float64:
		if isFinite(x) {
			return numberString(x), true
		}
	}
	return "", false
}

func object(v any) (map[string]any, bool) { m, ok := v.(map[string]any); return m, ok }

// readGeography validates and reads GeoJSON or TopoJSON. Problems are appended to issues with paths under path
// (e.g. geo.features[3].geometry). It returns nil when nothing usable remains. objects gives the document order of
// a Topology's objects, when it is known.
func readGeography(input any, opts GeographyOptions, issues *[]Issue, path, name string, objects func() []string) *geography {
	rd := &geoReader{issues: issues, path: path}
	in, ok := object(input)
	if !ok {
		rd.report("error", "bad_type", path, path+" must be a GeoJSON FeatureCollection or a TopoJSON Topology object.", "Register boundaries with RegisterGeography(name, data) and use the name here.")
		return nil
	}
	var raw []rawFeature
	vertices := 0
	switch kind, _ := in["type"].(string); kind {
	case "FeatureCollection":
		if raw, ok = readFeatureCollection(in, rd); !ok {
			return nil
		}
		for _, f := range raw {
			vertices += f.vertices
		}
	case "Topology":
		if raw, vertices, ok = readTopology(in, opts.Object, rd, objects); !ok {
			return nil
		}
	default:
		var hint []string
		if kind == "Feature" || kind == "Polygon" || kind == "MultiPolygon" {
			hint = []string{`Wrap it: {"type":"FeatureCollection","features":[...]}.`}
		}
		rd.report("error", "bad_geo", path+".type", path+`.type must be "FeatureCollection" (GeoJSON) or "Topology" (TopoJSON).`, hint...)
		return nil
	}
	if vertices > data.GeoLimits["maxVertices"] {
		rd.report("error", "too_many_vertices", path, fmt.Sprintf("The boundaries have %d points; the limit is %d.", vertices, data.GeoLimits["maxVertices"]), "Simplify them first (for example mapshaper -simplify 10%), or use a coarser edition such as 1:50m or 1:110m.")
		return nil
	}
	if len(raw) > data.GeoLimits["maxRegions"] {
		rd.report("error", "too_many_regions", path, fmt.Sprintf("%d regions; the limit is %d.", len(raw), data.GeoLimits["maxRegions"]), "Split the boundaries into several geographies, or dissolve small regions.")
		return nil
	}

	geo := &geography{name: name, lookup: map[string]string{}, byKey: map[string]int{}, vertices: vertices, attribution: opts.Attribution}
	for _, f := range raw {
		var keyValue any
		if opts.Key != nil {
			keyValue = opts.Key(f.properties, f.id)
		} else {
			keyValue = nullish(f.id, nullish(f.properties["id"], f.properties["name"]))
		}
		key, ok := asLabel(keyValue)
		if !ok {
			what := "id, properties.id or properties.name"
			if opts.Key != nil {
				what = "value for the key"
			}
			rd.report("warning", "geo_no_key", f.path, "Feature has no "+what+"; it is skipped.", "Give every feature an id, or set GeographyOptions.Key.")
			continue
		}
		if _, dup := geo.byKey[key]; dup {
			rd.report("warning", "duplicate_region", f.path, fmt.Sprintf("Region key %q appears more than once; the parts are merged.", key))
			continue
		}
		if f.polygons == 0 { // nothing to draw: the reference drops a region without polygons
			continue
		}
		nameValue := f.properties["name"]
		if opts.Name != nil {
			nameValue = opts.Name(f.properties, f.id)
		}
		label, ok := asLabel(nameValue)
		if !ok {
			label = key
		}
		disputedValue := f.properties["disputed"]
		if opts.Disputed != nil {
			disputedValue = opts.Disputed(f.properties, f.id)
		}
		disputed, _ := disputedValue.(bool)
		geo.byKey[key] = len(geo.regions)
		geo.regions = append(geo.regions, geoRegion{key, label, disputed})
	}
	if rd.errors > 0 {
		return nil
	}
	if len(geo.regions) == 0 {
		rd.report("error", "geo_empty", path, "No usable Polygon or MultiPolygon features.", "A map needs region polygons with longitude/latitude coordinates.")
		return nil
	}
	for _, r := range geo.regions {
		geo.lookup[normalizeRegion(r.key)] = r.key
		if _, taken := geo.lookup[normalizeRegion(r.name)]; !taken {
			geo.lookup[normalizeRegion(r.name)] = r.key
		}
	}
	for _, alias := range sortedKeys(opts.Aliases) {
		key := opts.Aliases[alias]
		if _, ok := geo.byKey[key]; ok {
			geo.lookup[normalizeRegion(alias)] = key
		} else {
			rd.report("warning", "bad_alias", path+".aliases."+alias, fmt.Sprintf("Alias %q points at %q, which is not a region key.", alias, key))
		}
	}
	return geo
}

func readFeatureCollection(fc map[string]any, rd *geoReader) ([]rawFeature, bool) {
	features, ok := fc["features"].([]any)
	if !ok {
		rd.report("error", "bad_geo", rd.path+".features", `A FeatureCollection needs a "features" array.`)
		return nil, false
	}
	out := []rawFeature{}
	for i, item := range features {
		p := fmt.Sprintf("%s.features[%d]", rd.path, i)
		f, ok := object(item)
		if kind, _ := f["type"].(string); !ok || kind != "Feature" {
			rd.report("error", "bad_geo", p, p+` must be a {"type":"Feature"} object.`)
			continue
		}
		props, _ := object(f["properties"])
		if props == nil {
			props = map[string]any{}
		}
		if f["geometry"] == nil {
			rd.report("warning", "geo_feature_skipped", p, "Feature has no geometry; it is skipped.")
			continue
		}
		g, ok := object(f["geometry"])
		if !ok {
			rd.report("error", "bad_geo", p+".geometry", "geometry must be an object.")
			continue
		}
		kind, _ := g["type"].(string)
		var polys any
		switch kind {
		case "Polygon":
			polys = []any{g["coordinates"]}
		case "MultiPolygon":
			polys = g["coordinates"]
		default:
			rd.report("warning", "geo_feature_skipped", p+".geometry", "This geometry is not a region; it is skipped.", "Maps join data to Polygon and MultiPolygon features. Plot point data with lat/lng columns instead.")
			continue
		}
		if polygons, vertices, ok := readPolys(polys, rd, p+".geometry.coordinates", kind == "Polygon"); ok {
			out = append(out, rawFeature{f["id"], props, polygons, vertices, p})
		}
	}
	return out, true
}

// readPolys returns the polygons with at least one ring and the positions of a coordinates array.
func readPolys(value any, rd *geoReader, path string, single bool) (polygons, vertices int, ok bool) {
	list, isList := value.([]any)
	if !isList {
		rd.report("error", "bad_geo", path, "coordinates must be nested arrays of [longitude, latitude] positions.")
		return 0, 0, false
	}
	for pi, item := range list {
		pp := path
		if !single {
			pp = fmt.Sprintf("%s[%d]", path, pi)
		}
		poly, isPoly := item.([]any)
		if !isPoly {
			rd.report("error", "bad_geo", pp, "A polygon must be an array of rings.")
			return 0, 0, false
		}
		rings := 0
		for ri, ring := range poly {
			n, ok := readRing(ring, rd, fmt.Sprintf("%s[%d]", pp, ri))
			if !ok {
				return 0, 0, false
			}
			// Without its outer ring a polygon's holes mean nothing: skip the polygon.
			if n == 0 && ri == 0 {
				break
			}
			if n > 0 {
				rings++
				vertices += n
			}
		}
		if rings > 0 {
			polygons++
		}
	}
	return polygons, vertices, true
}

// readRing returns the length of the ring once closed, or 0 for a degenerate ring (skipped with a warning).
func readRing(value any, rd *geoReader, path string) (int, bool) {
	ring, ok := value.([]any)
	if !ok {
		rd.report("error", "bad_geo", path, "A ring must be an array of [longitude, latitude] positions.")
		return 0, false
	}
	var first, last [2]float64
	for k, pos := range ring {
		p := fmt.Sprintf("%s[%d]", path, k)
		lng, lat, ok := position(pos)
		if !ok {
			rd.report("error", "bad_geo", p, "A position must be [longitude, latitude] with two finite numbers.")
			return 0, false
		}
		if !checkPosition(lng, lat, rd, p) {
			return 0, false
		}
		last = [2]float64{lng, lat}
		if k == 0 {
			first = last
		}
	}
	return closeRing(len(ring), first, last, rd, path), true
}

func checkPosition(lng, lat float64, rd *geoReader, path string) bool {
	if math.Abs(lng) <= 360 && math.Abs(lat) <= 90 {
		return true
	}
	hint := "Longitude must be within -360..360 and latitude within -90..90; check for swapped values."
	if math.Abs(lng) > 1000 || math.Abs(lat) > 1000 {
		hint = "This looks like projected coordinates (metres). Re-export the boundaries in WGS 84 (EPSG:4326)."
	}
	rd.report("error", "geo_out_of_range", path, fmt.Sprintf("Position [%s, %s] is not a longitude/latitude in degrees.", numberString(lng), numberString(lat)), hint)
	return false
}

func closeRing(n int, first, last [2]float64, rd *geoReader, path string) int {
	if n > 0 && first != last {
		n++
	}
	if n < 4 {
		// A sliver left over from simplification: drop it rather than reject a whole file for it.
		rd.report("warning", "geo_bad_ring", path, fmt.Sprintf("A ring needs at least 4 positions (a closed triangle), got %d; it is skipped.", n))
		return 0
	}
	return n
}

// toInt32 is JavaScript's ToInt32 of an integral float.
func toInt32(f float64) int32 {
	m := math.Mod(f, 4294967296)
	if m < 0 {
		m += 4294967296
	}
	return int32(uint32(m))
}

func readTopology(t map[string]any, objName string, rd *geoReader, order func() []string) ([]rawFeature, int, bool) {
	path := rd.path
	objects, ok := object(t["objects"])
	if !ok || len(objects) == 0 {
		rd.report("error", "bad_geo", path+".objects", `A Topology needs a non-empty "objects" map.`)
		return nil, 0, false
	}
	arcsIn, ok := t["arcs"].([]any)
	if !ok {
		rd.report("error", "bad_geo", path+".arcs", `A Topology needs an "arcs" array.`)
		return nil, 0, false
	}
	names := sortedKeys(objects)
	if objName == "" {
		objName = names[0]
		if len(names) > 1 && order != nil {
			if doc := order(); len(doc) > 0 {
				if _, ok := objects[doc[0]]; ok {
					objName = doc[0]
				}
			}
		}
	}
	obj, ok := object(objects[objName])
	if !ok {
		near, found := closest(objName, names)
		rd.report("error", "bad_geo", path+".objects", fmt.Sprintf("Topology has no object %q.", objName), didYouMean(near, found)+"Objects: "+strings.Join(names, ", ")+".")
		return nil, 0, false
	}
	scale, translate, quantized := [2]float64{1, 1}, [2]float64{0, 0}, false
	if tr, has := t["transform"]; has {
		m, _ := object(tr)
		s, sOK := m["scale"].([]any)
		l, lOK := m["translate"].([]any)
		good := sOK && lOK && len(s) == 2 && len(l) == 2
		for i := 0; good && i < 2; i++ {
			var a, b bool
			scale[i], a = finite(s[i])
			translate[i], b = finite(l[i])
			good = a && b
		}
		if !good {
			rd.report("error", "bad_geo", path+".transform", `transform must be {"scale":[sx,sy],"translate":[tx,ty]} with numbers.`)
			return nil, 0, false
		}
		quantized = true
	}
	// Decode every arc once (delta-encoded when quantized).
	arcs := make([][][2]float64, 0, len(arcsIn))
	vertices := 0
	for i, item := range arcsIn {
		p := fmt.Sprintf("%s.arcs[%d]", path, i)
		a, ok := item.([]any)
		if !ok {
			rd.report("error", "bad_geo", p, "An arc must be an array of positions.")
			return nil, 0, false
		}
		vertices += len(a)
		if vertices > data.GeoLimits["maxVertices"] {
			return []rawFeature{}, vertices, true
		}
		x, y := 0.0, 0.0
		out := make([][2]float64, 0, len(a))
		for k, pos := range a {
			pk := fmt.Sprintf("%s[%d]", p, k)
			px, py, ok := position(pos)
			if !ok {
				rd.report("error", "bad_geo", pk, "An arc position must be two finite numbers.")
				return nil, 0, false
			}
			if quantized {
				x += px
				y += py
			} else {
				x, y = px, py
			}
			// Each product is rounded before the sum, as in JavaScript (no fused multiply-add).
			lng := float64(x*scale[0]) + translate[0]
			lat := float64(y*scale[1]) + translate[1]
			if !checkPosition(lng, lat, rd, pk) {
				return nil, 0, false
			}
			out = append(out, [2]float64{lng, lat})
		}
		arcs = append(arcs, out)
	}
	// ringOf returns the length of the ring, or 0 for a degenerate one.
	ringOf := func(value any, p string) (int, bool) {
		ids, ok := value.([]any)
		if !ok || len(ids) == 0 {
			rd.report("error", "bad_geo", p, "A ring must be a non-empty array of arc indexes.")
			return 0, false
		}
		n := 0
		var first, last [2]float64
		for k, ref := range ids {
			f, isNum := finite(ref)
			idx := -1.0
			if isNum && f == math.Trunc(f) {
				idx = f
				if f < 0 {
					idx = float64(^toInt32(f))
				}
			}
			if idx < 0 || idx >= float64(len(arcs)) {
				rd.report("error", "bad_geo", fmt.Sprintf("%s[%d]", p, k), fmt.Sprintf("Arc index %s does not exist (there are %d arcs).", show(ref), len(arcs)))
				return 0, false
			}
			arc := arcs[int(idx)]
			// The arc's points in ring order, without the first when it repeats the ring's last point.
			count, start := len(arc), 0
			if n > 0 {
				start = 1
			}
			if count <= start {
				continue
			}
			at := func(j int) [2]float64 {
				if f < 0 {
					return arc[count-1-j]
				}
				return arc[j]
			}
			if n == 0 {
				first = at(start)
			}
			last = at(count - 1)
			n += count - start
		}
		return closeRing(n, first, last, rd, p), true
	}
	// polyOf returns the number of rings kept (0: no polygon).
	polyOf := func(value any, p string) (int, bool) {
		rings, ok := value.([]any)
		if !ok {
			rd.report("error", "bad_geo", p, "A polygon must be an array of rings.")
			return 0, false
		}
		kept := 0
		for k, r := range rings {
			n, ok := ringOf(r, fmt.Sprintf("%s[%d]", p, k))
			if !ok {
				return 0, false
			}
			if n == 0 && k == 0 {
				break
			}
			if n > 0 {
				kept++
			}
		}
		return kept, true
	}
	objType, _ := obj["type"].(string)
	collection := objType == "GeometryCollection"
	objPath := path + ".objects." + objName
	geoms := []any{obj}
	if collection {
		if geoms, ok = obj["geometries"].([]any); !ok {
			rd.report("error", "bad_geo", objPath+".geometries", `A GeometryCollection needs a "geometries" array.`)
			return nil, 0, false
		}
	}
	features := []rawFeature{}
	for i, item := range geoms {
		p := objPath
		if collection {
			p = fmt.Sprintf("%s.geometries[%d]", objPath, i)
		}
		g, ok := object(item)
		if !ok {
			rd.report("error", "bad_geo", p, "A geometry must be an object.")
			continue
		}
		props, _ := object(g["properties"])
		if props == nil {
			props = map[string]any{}
		}
		polygons := 0
		switch kind, _ := g["type"].(string); {
		case kind == "Polygon":
			n, ok := polyOf(g["arcs"], p+".arcs")
			if !ok {
				continue
			}
			if n > 0 {
				polygons = 1
			}
		case kind == "MultiPolygon":
			parts, ok := g["arcs"].([]any)
			if !ok {
				rd.report("error", "bad_geo", p+".arcs", "A MultiPolygon needs an array of polygons.")
				continue
			}
			good := true
			for k, part := range parts {
				n, ok := polyOf(part, fmt.Sprintf("%s.arcs[%d]", p, k))
				if !ok {
					good = false
					break
				}
				if n > 0 {
					polygons++
				}
			}
			if !good {
				continue
			}
		case g["type"] == nil:
			rd.report("warning", "geo_feature_skipped", p, "Geometry has no type; it is skipped.")
			continue
		default:
			rd.report("warning", "geo_feature_skipped", p, "This geometry is not a region; it is skipped.")
			continue
		}
		features = append(features, rawFeature{g["id"], props, polygons, 0, p})
	}
	return features, vertices, true
}

// resolveGeo resolves a spec's geo value: a registered name or an inline object.
func resolveGeo(value any, issues *[]Issue, path string, objects func() []string) *geography {
	if name, ok := value.(string); ok {
		geoMu.RLock()
		g := geoRegistry[name]
		names := append([]string(nil), geoOrder...)
		geoMu.RUnlock()
		if g != nil {
			return g
		}
		hint := "Super Plot ships no boundaries. Import the dataset you have chosen with RegisterGeography(name, geojsonOrTopojson, preset), or put a small FeatureCollection inline."
		if len(names) > 0 {
			near, found := closest(name, names)
			if len(names) > 20 {
				names = names[:20]
			}
			hint = didYouMean(near, found) + "Registered: " + strings.Join(names, ", ") + "."
		}
		add(issues, "error", "unknown_geography", path, fmt.Sprintf("No geography named %q is registered.", name), hint)
		return nil
	}
	return readGeography(value, GeographyOptions{}, issues, path, "inline", objects)
}
