package main

import (
	"go/ast"
	"go/doc"
	"go/parser"
	"go/token"
	"strings"
	"testing"
)

const routerSource = `// Package router routes requests.
//
// # Routing
//
// Use [NewRouter] to build a [*Router]; [Router.Get] adds a route that
// serves an [http.Handler]. Paths such as a_b_c stay as written.
package router

import "net/http"

// Router holds routes.
type Router struct{}

// NewRouter returns an empty router.
func NewRouter() *Router { return &Router{} }

// Get routes GET requests for pattern to h.
func (r *Router) Get(pattern string, h http.Handler) {}
`

func parseRouter(t *testing.T) (*token.FileSet, *doc.Package) {
	t.Helper()
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "router.go", routerSource, parser.ParseComments)
	if err != nil {
		t.Fatal(err)
	}
	d, err := doc.NewFromFiles(fset, []*ast.File{file}, "example.com/router")
	if err != nil {
		t.Fatal(err)
	}
	return fset, d
}

func TestFuncSignatureKeepsTheReceiver(t *testing.T) {
	fset, d := parseRouter(t)
	got := extractFunc(fset, "", d.Types[0].Methods[0]).Signature
	if want := "func (r *Router) Get(pattern string, h http.Handler)"; got != want {
		t.Fatalf("signature = %q, want %q", got, want)
	}
}

func TestDocMarkdownLinksSymbolsAndEscapesProse(t *testing.T) {
	_, d := parseRouter(t)
	got := newDocRenderer(d).markdown(d.Doc)
	for _, want := range []string{
		"### Routing\n",
		"[NewRouter](#func-NewRouter)",
		"[\\*Router](#type-Router)",
		"[Router.Get](#method-Router-Get)",
		"[http.Handler](https://pkg.go.dev/net/http#Handler)",
		"a\\_b\\_c",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("markdown is missing %q:\n%s", want, got)
		}
	}
	if strings.Contains(got, "{#hdr-") {
		t.Errorf("markdown keeps the printer's heading id:\n%s", got)
	}
}
