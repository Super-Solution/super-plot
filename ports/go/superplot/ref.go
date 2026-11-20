// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
package superplot

// Card references: `ref:<target>?<name>=<value>&...`, the link a chat message uses to point into a card.
//
// COPY of the card reference shell of super-protocol (PR #6, `implementations/go/protocol/ref.go`, protocol 0.3.0,
// not published yet). Replace this file with an import of the protocol module once 0.3.0 is released. Keep it
// identical until then: the names, limits and every message are the protocol's, and conformance/card-ref.v1.json
// holds the protocol's own cases, which this copy and the TypeScript and Python copies must pass. Only the envelope
// is copied: what the params mean for a plot is Super Plot's own (resolve.go).

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

const (
	CardRefScheme     = "ref"
	maxRefLength      = 512
	maxRefNames       = 16
	maxRefValues      = 32
	maxRefValueLength = 256
)

// CardRefLimits are the protocol's limits: the whole link and one decoded value in UTF-16 units, the target, the
// distinct param names, the values of one name, and one name.
var CardRefLimits = map[string]int{"length": maxRefLength, "target": 128, "names": maxRefNames, "values": maxRefValues, "name": 32, "value": maxRefValueLength}

var (
	refTargetRe   = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`)
	refNameRe     = regexp.MustCompile(`^[a-z][A-Za-z0-9_-]{0,31}$`)
	refRawValueRe = regexp.MustCompile(`^(?:[A-Za-z0-9._~-]|%[0-9A-Fa-f]{2})+$`)
)

// CardRef is a parsed reference. A param repeated in the link is a list, in order.
type CardRef struct {
	Target string              `json:"target"`
	Params map[string][]string `json:"params"`
}

// CardRefParse is the outcome of ParseCardRef.
type CardRefParse struct {
	OK    bool     `json:"ok"`
	Ref   *CardRef `json:"ref,omitempty"`
	Error string   `json:"error,omitempty"`
}

func refFail(message string) CardRefParse { return CardRefParse{Error: message} }

func decodeRefValue(raw string) (string, bool) {
	bytes := make([]byte, 0, len(raw))
	for i := 0; i < len(raw); i++ {
		if raw[i] == '%' {
			n, _ := strconv.ParseUint(raw[i+1:i+3], 16, 8)
			bytes = append(bytes, byte(n))
			i += 2
		} else {
			bytes = append(bytes, raw[i])
		}
	}
	if !utf8.Valid(bytes) {
		return "", false
	}
	return string(bytes), true
}

func encodeRefValue(value string) string {
	var b strings.Builder
	// A string that is not valid UTF-8 is written as JavaScript's TextEncoder would: U+FFFD for each bad byte.
	for _, c := range []byte(strings.ToValidUTF8(value, "�")) {
		if c < 128 && (c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '.' || c == '_' || c == '~' || c == '-') {
			b.WriteByte(c)
		} else {
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return b.String()
}

// ParseCardRef reads a `ref:` link given as decoded JSON; anything but a string is refused.
func ParseCardRef(href any) CardRefParse {
	s, ok := href.(string)
	if !ok {
		return refFail("a ref must be a string.")
	}
	if ulen(s) > maxRefLength {
		return refFail(fmt.Sprintf("a ref is at most %d characters.", maxRefLength))
	}
	if !strings.HasPrefix(s, CardRefScheme+":") {
		return refFail(fmt.Sprintf("a ref starts with %q.", CardRefScheme+":"))
	}
	rest := s[len(CardRefScheme)+1:]
	if strings.Contains(rest, "#") {
		return refFail("a ref has no fragment.")
	}
	target, query, hasQuery := strings.Cut(rest, "?")
	if !refTargetRe.MatchString(target) {
		return refFail("a ref target is 1 to 128 letters, digits, dot, underscore, colon or dash, starting with a letter or digit.")
	}
	params := map[string][]string{}
	if hasQuery {
		if query == "" {
			return refFail("a ref query is empty.")
		}
		for _, part := range strings.Split(query, "&") {
			name, raw, hasEq := strings.Cut(part, "=")
			if !hasEq {
				return refFail("each ref param is name=value.")
			}
			if !refNameRe.MatchString(name) {
				return refFail("a ref param name is 1 to 32 letters, digits, dash or underscore, starting with a lowercase letter.")
			}
			if !refRawValueRe.MatchString(raw) {
				return refFail("a ref param value is not empty and uses letters, digits, dot, dash, underscore, tilde or %XX only.")
			}
			value, valid := decodeRefValue(raw)
			if !valid {
				return refFail("a ref param value must be valid UTF-8.")
			}
			if ulen(value) > maxRefValueLength {
				return refFail(fmt.Sprintf("a ref param value is at most %d characters.", maxRefValueLength))
			}
			if _, seen := params[name]; !seen {
				if len(params) >= maxRefNames {
					return refFail(fmt.Sprintf("a ref has at most %d param names.", maxRefNames))
				}
				params[name] = []string{}
			}
			if len(params[name]) >= maxRefValues {
				return refFail(fmt.Sprintf("a ref param has at most %d values.", maxRefValues))
			}
			params[name] = append(params[name], value)
		}
	}
	return CardRefParse{OK: true, Ref: &CardRef{Target: target, Params: params}}
}

// FormatCardRef writes a reference as a `ref:` link, names in alphabetical order. ok is false when the
// reference breaks a limit. The input is decoded JSON (or a CardRef), like the validators take.
func FormatCardRef(ref any) (link string, ok bool) {
	if r, isRef := ref.(CardRef); isRef {
		ref = r.decoded()
	} else if r, isRef := ref.(*CardRef); isRef && r != nil {
		ref = r.decoded()
	}
	m, isMap := ref.(map[string]any)
	if !isMap {
		return "", false
	}
	t, isString := m["target"].(string)
	if !isString || !refTargetRe.MatchString(t) {
		return "", false
	}
	params, isMap := m["params"].(map[string]any)
	if !isMap || len(params) > maxRefNames {
		return "", false
	}
	names := make([]string, 0, len(params))
	for name := range params {
		names = append(names, name)
	}
	sort.Slice(names, func(i, j int) bool { return utf16Compare(names[i], names[j]) < 0 })
	parts := []string{}
	for _, name := range names {
		values, isList := params[name].([]any)
		if !refNameRe.MatchString(name) || !isList || len(values) == 0 || len(values) > maxRefValues {
			return "", false
		}
		for _, item := range values {
			value, isText := item.(string)
			if !isText || value == "" || ulen(value) > maxRefValueLength {
				return "", false
			}
			parts = append(parts, name+"="+encodeRefValue(value))
		}
	}
	link = CardRefScheme + ":" + t
	if len(parts) > 0 {
		link += "?" + strings.Join(parts, "&")
	}
	if ulen(link) > maxRefLength {
		return "", false
	}
	return link, true
}

// decoded is the reference as decoded JSON, the shape FormatCardRef reads.
func (r CardRef) decoded() map[string]any {
	params := map[string]any{}
	for k, vs := range r.Params {
		list := make([]any, len(vs))
		for i, v := range vs {
			list[i] = v
		}
		params[k] = list
	}
	return map[string]any{"target": r.Target, "params": params}
}
