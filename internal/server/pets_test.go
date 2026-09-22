package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func writeTestPet(t *testing.T, root, id string, extraFiles map[string]string) {
	t.Helper()
	dir := filepath.Join(root, id)
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	manifest := `{"id":"` + id + `","displayName":"Test ` + id + `","spritesheetPath":"spritesheet.webp"}`
	if err := os.WriteFile(filepath.Join(dir, "pet.json"), []byte(manifest), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "spritesheet.webp"), []byte("RIFF....WEBP"), 0644); err != nil {
		t.Fatal(err)
	}
	for name, body := range extraFiles {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0644); err != nil {
			t.Fatal(err)
		}
	}
}

func newPetTestServer(t *testing.T) (*Server, string) {
	t.Helper()
	agentDir := t.TempDir()
	petsRoot := filepath.Join(agentDir, "pi-web", "pets")
	writeTestPet(t, petsRoot, "codie", nil)
	// A second pet carries the optional pi-web fio.json extension manifest.
	writeTestPet(t, petsRoot, "fio-observer", map[string]string{
		"fio.json": `{"schemaVersion":1,"character":"fio","persona":"observer"}`,
	})
	return &Server{agentDir: agentDir}, petsRoot
}

func TestHandleApiPetsListsPackages(t *testing.T) {
	s, _ := newPetTestServer(t)
	req := httptest.NewRequest(http.MethodGet, "/api/pets", nil)
	rec := httptest.NewRecorder()
	s.handleApiPets(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	var out struct {
		Pets []petSummary `json:"pets"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	// The user's real ~/.codex/pets may also be scanned; assert our fixture is
	// present rather than requiring an exact-length list.
	var found *petSummary
	for i := range out.Pets {
		if out.Pets[i].ID == "codie" {
			found = &out.Pets[i]
		}
	}
	if found == nil || found.Source != "pi-web" {
		t.Fatalf("codie not found in %+v", out.Pets)
	}
}

func TestHandlePetFileServesManifestAndImage(t *testing.T) {
	s, _ := newPetTestServer(t)

	rec := httptest.NewRecorder()
	s.handlePetFile(rec, httptest.NewRequest(http.MethodGet, "/api/pet/file?pet=codie&file=pet.json", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("pet.json status %d", rec.Code)
	}

	rec = httptest.NewRecorder()
	s.handlePetFile(rec, httptest.NewRequest(http.MethodGet, "/api/pet/file?pet=codie&file=spritesheet.webp", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("spritesheet status %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "image/webp" {
		t.Fatalf("content-type %q", ct)
	}
}

func TestHandlePetFileServesFioExtension(t *testing.T) {
	s, _ := newPetTestServer(t)

	// fio.json present → served.
	rec := httptest.NewRecorder()
	s.handlePetFile(rec, httptest.NewRequest(http.MethodGet, "/api/pet/file?pet=fio-observer&file=fio.json", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("fio.json status %d", rec.Code)
	}
	var fio map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &fio); err != nil {
		t.Fatal(err)
	}
	if fio["character"] != "fio" {
		t.Fatalf("unexpected fio.json: %v", fio)
	}

	// fio.json absent on a plain Codex pet → 404, not an error.
	rec = httptest.NewRecorder()
	s.handlePetFile(rec, httptest.NewRequest(http.MethodGet, "/api/pet/file?pet=codie&file=fio.json", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("absent fio.json should 404, got %d", rec.Code)
	}
}

func TestHandlePetFileRejectsTraversalAndUnknown(t *testing.T) {
	s, _ := newPetTestServer(t)

	for _, url := range []string{
		"/api/pet/file?pet=..&file=pet.json",
		"/api/pet/file?pet=codie&file=../../secret",
		"/api/pet/file?pet=codie&file=evil.sh",
		"/api/pet/file?pet=missing&file=pet.json",
	} {
		rec := httptest.NewRecorder()
		s.handlePetFile(rec, httptest.NewRequest(http.MethodGet, url, nil))
		if rec.Code == http.StatusOK {
			t.Fatalf("%s unexpectedly served", url)
		}
	}
}
