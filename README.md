
# Rahul Gomes — Academic Website

A lightweight, multi-page academic website in a **light theme** with serif headings and UW–Eau Claire colors.  
Content is loaded from JSON files so you can update publications, grants, research projects, media, and updates without editing HTML.

## Structure
- `index.html` — Home + Recent Updates
- `about.html` — Bio, Education, Employment, Invited Talks, Awards
- `research.html` — Combined research projects and students page
- `students.html` — Redirect to the students section of `research.html`
- `teaching.html` — Courses taught
- `publications.html` — Full citations (peer-reviewed, posters, regional)
- `grants.html` — Grants only (also listed in Research)
- `media.html` — Media coverage
- `contact.html` — Contact & profile links
- `cv.html` — Embedded / downloadable CV
- `data/*.json` — Content files
- `assets/style.css` — Styling
- `assets/script.js` — JSON loader + search utilities

## Update Content
Edit the JSON files in `data/`:
- `publications.json`
- `grants.json`
- `research.json`
- `teaching.json`
- `media.json`
- `updates.json`
- `about.json`

Then commit and push — no HTML changes needed.

## Update Publications from Google Scholar

Publications can be refreshed manually from Rahul Gomes's Google Scholar profile. The updater runs only on your computer; the deployed website remains static and continues to read `data/publications.json`.

From the repository root, create a Python environment and install the updater dependency:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r scripts/requirements.txt
```

Preview an update first:

```bash
python scripts/update_publications.py --dry-run
```

If the preview is correct, write the validated update and review it before committing:

```bash
python scripts/update_publications.py
git diff -- data/publications.json
git add data/publications.json
git commit -m "Update publications"
git push
```

The Scholar author ID is configured as `GOOGLE_SCHOLAR_AUTHOR_ID` near the top of `scripts/update_publications.py`. It was taken from the Google Scholar links already used by this website.

### Corrections, categories, and exclusions

Use `data/publication_overrides.json` for Scholar metadata that needs correction. An override can be keyed by Scholar's `author_pub_id` in `by_scholar_id`, or by a title in `by_title`. Scholar IDs take precedence when both match. For example:

```json
{
  "by_scholar_id": {
    "s2LUBTQAAAAJ:example": {
      "doi": "10.0000/example",
      "link": "https://doi.org/10.0000/example",
      "publication_type": "peer_reviewed"
    }
  },
  "by_title": {
    "Example poster title": {
      "venue": "Corrected venue",
      "publication_type": "posters_and_abstracts"
    },
    "Title to omit": {
      "exclude": true
    }
  }
}
```

Valid production categories are `peer_reviewed`, `posters_and_abstracts`, and `regional_ug`. Newly discovered Scholar titles are treated as `unclassified` and are not added to `data/publications.json` until an override explicitly assigns one of those three production categories. Other fields, including site-specific metadata, can also be added through an override. Existing publications retain their current categories, and publications not returned by Scholar are preserved automatically; you can continue adding such records directly to `data/publications.json`.

The updater fetches the author publication list and only requests full details for newly discovered titles. It does not request citing papers or perform citation analytics. If Scholar blocks the request, presents a CAPTCHA, changes its page structure, or the network fails, the command exits with an error and leaves `data/publications.json` unchanged. It also refuses an empty result or an output containing fewer than 75% of the existing publication count.

Updates are written to a temporary file, parsed and validated, and then atomically moved into place. A separate backup file is not created because the existing file remains visible in `git diff` and recoverable through Git history.

## Deploy to GitHub Pages
Option A — User site (recommended):
1. Create a public repo named `yourusername.github.io`.
2. Add all files from this folder to the repo root.
3. Commit & push.
4. Visit `https://yourusername.github.io` after 1–2 minutes.

Option B — Project site:
1. Create a public repo with any name.
2. Push files to the repo root (or `/docs` if you prefer).
3. In **Settings → Pages**, choose **Branch: `main` (or `gh-pages`)** and **/ (root)**.
4. Save and wait for the green check.

## Customization
- Update site title and affiliation in `assets/header` (duplicated per page inside the template). Search for `Rahul Gomes, Ph.D.` to change.
- Replace colors by editing `:root` variables in `assets/style.css`.
- Add current students: edit the project `students` arrays in `data/research.json`; maintain the compact past-student list in `research.html`.
- Add publications: edit `data/publications.json` (keep fields: `year`, `title`, `authors`, `venue`, `doi` and/or `link`).

## License
MIT — Feel free to adapt for your lab.
