#!/usr/bin/env python3
"""Update the site's publication data from a Google Scholar author profile.

The updater intentionally preserves existing records. Google Scholar is used to
discover new publications, while data/publication_overrides.json handles
corrections, exclusions, and site-specific publication categories.
"""

from __future__ import annotations

import argparse
import copy
import json
import math
import os
import re
import sys
import tempfile
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote


GOOGLE_SCHOLAR_AUTHOR_ID = "s2LUBTQAAAAJ"
MINIMUM_COUNT_RATIO = 0.75
PUBLICATION_TYPES = (
    "peer_reviewed",
    "posters_and_abstracts",
    "regional_ug",
)

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
PUBLICATIONS_PATH = REPOSITORY_ROOT / "data" / "publications.json"
OVERRIDES_PATH = REPOSITORY_ROOT / "data" / "publication_overrides.json"


class UpdateError(RuntimeError):
    """An expected updater failure that should not change production data."""


@dataclass
class UpdateStats:
    existing_count: int = 0
    scholar_count: int = 0
    final_count: int = 0
    added: list[str] = field(default_factory=list)
    manually_preserved: list[str] = field(default_factory=list)
    duplicates: list[str] = field(default_factory=list)
    excluded: list[str] = field(default_factory=list)
    unclassified: list[str] = field(default_factory=list)
    changed: list[str] = field(default_factory=list)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Refresh data/publications.json from Google Scholar."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="retrieve and validate publications without changing publications.json",
    )
    return parser.parse_args(argv)


def load_json(path: Path) -> Any:
    try:
        with path.open(encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError as exc:
        raise UpdateError(f"Required file not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise UpdateError(f"Invalid JSON in {path}: {exc}") from exc


def normalize_title(title: str) -> str:
    """Conservatively normalize a title for exact duplicate matching."""
    text = unicodedata.normalize("NFKD", str(title)).casefold()
    text = "".join(char for char in text if not unicodedata.combining(char))
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return " ".join(text.split())


def publication_count(data: dict[str, Any]) -> int:
    return sum(len(data.get(section, [])) for section in PUBLICATION_TYPES)


def validate_publication_data(
    data: Any,
    existing_count: int,
    minimum_ratio: float = MINIMUM_COUNT_RATIO,
) -> None:
    if not isinstance(data, dict):
        raise UpdateError("Publication output must be a JSON object.")

    for section in PUBLICATION_TYPES:
        if not isinstance(data.get(section), list):
            raise UpdateError(f"Publication section '{section}' must be a list.")
        for index, publication in enumerate(data[section]):
            if not isinstance(publication, dict):
                raise UpdateError(f"{section}[{index}] must be a JSON object.")
            if not str(publication.get("title", "")).strip():
                raise UpdateError(f"{section}[{index}] does not have a title.")

    new_count = publication_count(data)
    if new_count < 1:
        raise UpdateError("The generated publication list is empty.")

    minimum_count = math.ceil(existing_count * minimum_ratio)
    if existing_count and new_count < minimum_count:
        raise UpdateError(
            f"Safety check failed: generated {new_count} publications, but at "
            f"least {minimum_count} are required based on the existing "
            f"{existing_count} records."
        )

    try:
        json.loads(json.dumps(data, ensure_ascii=False))
    except (TypeError, ValueError) as exc:
        raise UpdateError(f"Generated data is not valid JSON: {exc}") from exc


def load_overrides(path: Path = OVERRIDES_PATH) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {"by_scholar_id": {}, "by_title": {}}

    raw = load_json(path)
    if not isinstance(raw, dict):
        raise UpdateError("publication_overrides.json must contain a JSON object.")

    by_id = raw.get("by_scholar_id", {})
    by_title = raw.get("by_title", {})
    if not isinstance(by_id, dict) or not isinstance(by_title, dict):
        raise UpdateError("Override sections must be JSON objects.")

    normalized_titles: dict[str, Any] = {}
    for title, override in by_title.items():
        key = normalize_title(title)
        if not key:
            raise UpdateError("An override title normalizes to an empty value.")
        if key in normalized_titles:
            raise UpdateError(f"Duplicate normalized title override: {title}")
        if not isinstance(override, dict):
            raise UpdateError(f"Override for '{title}' must be a JSON object.")
        normalized_titles[key] = override

    for scholar_id, override in by_id.items():
        if not isinstance(override, dict):
            raise UpdateError(
                f"Override for Scholar ID '{scholar_id}' must be a JSON object."
            )

    return {"by_scholar_id": by_id, "by_title": normalized_titles}


def fetch_scholar_publications() -> tuple[list[dict[str, Any]], Callable]:
    """Fetch the author publication list without citation-detail queries."""
    try:
        from scholarly import scholarly
    except ImportError as exc:
        raise UpdateError(
            "The 'scholarly' package or one of its compatible dependencies "
            "could not be imported. Run "
            "'python -m pip install -r scripts/requirements.txt' first. "
            f"Import error: {exc}"
        ) from exc

    try:
        author = scholarly.search_author_id(GOOGLE_SCHOLAR_AUTHOR_ID)
        author = scholarly.fill(author, sections=["publications"])
        publications = author.get("publications", [])
    except Exception as exc:
        raise UpdateError(
            "Google Scholar could not be read. It may be blocking automated "
            f"requests, showing a CAPTCHA, rate-limiting, or unavailable: {exc}"
        ) from exc

    if not isinstance(publications, list) or not publications:
        raise UpdateError(
            "Google Scholar returned no publications; publications.json was not changed."
        )

    return publications, scholarly.fill


def scholar_id(publication: dict[str, Any]) -> str:
    return str(publication.get("author_pub_id", "")).strip()


def scholar_title(publication: dict[str, Any]) -> str:
    bib = publication.get("bib", {})
    return str(bib.get("title", "")).strip() if isinstance(bib, dict) else ""


def scholar_profile_url(publication_id: str) -> str:
    return (
        "https://scholar.google.com/citations?view_op=view_citation&citation_for_view="
        + quote(publication_id, safe=":")
    )


def format_authors(value: Any) -> str:
    if isinstance(value, list):
        return "; ".join(str(author).strip() for author in value if str(author).strip())
    if not value:
        return ""
    text = str(value).strip()
    if " and " in text:
        return "; ".join(part.strip() for part in text.split(" and ") if part.strip())
    return text


def parse_year(value: Any) -> int | str | None:
    if isinstance(value, int):
        return value
    match = re.search(r"\b(19|20)\d{2}\b", str(value or ""))
    return int(match.group(0)) if match else None


def first_value(mapping: dict[str, Any], keys: tuple[str, ...]) -> Any:
    for key in keys:
        value = mapping.get(key)
        if value not in (None, "", "NA"):
            return value
    return None


def publication_from_scholar(publication: dict[str, Any]) -> dict[str, Any]:
    bib = publication.get("bib", {})
    if not isinstance(bib, dict):
        bib = {}

    title = str(bib.get("title", "")).strip()
    if not title:
        raise UpdateError("A Google Scholar publication has no title.")

    record: dict[str, Any] = {"title": title}
    year = parse_year(bib.get("pub_year") or bib.get("year"))
    authors = format_authors(bib.get("author") or bib.get("authors"))
    venue = first_value(
        bib,
        ("journal", "conference", "booktitle", "venue", "citation"),
    )

    if year is not None:
        record["year"] = year
    if authors:
        record["authors"] = authors
    if venue:
        record["venue"] = str(venue).strip()

    optional_bib_fields = {
        "volume": "volume",
        "number": "issue",
        "issue": "issue",
        "pages": "pages",
        "publisher": "publisher",
        "doi": "doi",
    }
    for source_key, output_key in optional_bib_fields.items():
        value = bib.get(source_key)
        if value not in (None, "") and output_key not in record:
            record[output_key] = value

    publication_id = scholar_id(publication)
    if publication_id:
        record["scholar_id"] = publication_id
        record["scholar_url"] = scholar_profile_url(publication_id)

    link = publication.get("pub_url") or publication.get("eprint_url")
    if link:
        record["link"] = link

    citations = publication.get("num_citations")
    if isinstance(citations, int):
        record["citations"] = citations

    record["source"] = "google_scholar"
    return record


def override_for(
    title: str,
    publication_id: str,
    overrides: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    combined: dict[str, Any] = {}
    combined.update(overrides["by_title"].get(normalize_title(title), {}))
    if publication_id:
        combined.update(overrides["by_scholar_id"].get(publication_id, {}))
    return combined


def apply_override(
    record: dict[str, Any],
    default_type: str,
    override: dict[str, Any],
    allow_unclassified: bool = False,
) -> tuple[dict[str, Any], str, bool]:
    updated = copy.deepcopy(record)
    publication_type = override.get("publication_type", default_type)
    allowed_types = PUBLICATION_TYPES + (("unclassified",) if allow_unclassified else ())
    if publication_type not in allowed_types:
        raise UpdateError(
            f"Invalid publication_type '{publication_type}' for "
            f"'{record.get('title', 'untitled')}'."
        )

    excluded = bool(override.get("exclude", False))
    for key, value in override.items():
        if key in {"exclude", "publication_type"}:
            continue
        if value is None:
            updated.pop(key, None)
        else:
            updated[key] = value
    return updated, publication_type, excluded


def flatten_existing(data: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    records: list[tuple[str, dict[str, Any]]] = []
    for publication_type in PUBLICATION_TYPES:
        for publication in data.get(publication_type, []):
            records.append((publication_type, copy.deepcopy(publication)))
    return records


def sort_key(publication: dict[str, Any]) -> tuple[int, str]:
    year = parse_year(publication.get("year"))
    return (-(year or 0), normalize_title(publication.get("title", "")))


def build_updated_data(
    existing_data: dict[str, Any],
    scholar_publications: list[dict[str, Any]],
    fill_publication: Callable[[dict[str, Any]], dict[str, Any]],
    overrides: dict[str, dict[str, Any]],
) -> tuple[dict[str, list[dict[str, Any]]], UpdateStats]:
    validate_publication_data(existing_data, 0)
    existing = flatten_existing(existing_data)
    stats = UpdateStats(
        existing_count=len(existing),
        scholar_count=len(scholar_publications),
    )

    scholar_by_title: dict[str, dict[str, Any]] = {}
    for publication in scholar_publications:
        title = scholar_title(publication)
        normalized = normalize_title(title)
        if not normalized:
            raise UpdateError("Google Scholar returned a publication without a title.")
        if normalized in scholar_by_title:
            stats.duplicates.append(title)
            continue
        scholar_by_title[normalized] = publication

    output: dict[str, list[dict[str, Any]]] = {
        section: [] for section in PUBLICATION_TYPES
    }
    existing_titles = {normalize_title(record.get("title", "")) for _, record in existing}

    for publication_type, original in existing:
        title = str(original.get("title", "")).strip()
        scholar_match = scholar_by_title.get(normalize_title(title))
        publication_id = scholar_id(scholar_match) if scholar_match else ""
        override = override_for(title, publication_id, overrides)
        updated, target_type, excluded = apply_override(
            original, publication_type, override
        )

        if excluded:
            stats.excluded.append(title)
            continue

        if not scholar_match:
            stats.manually_preserved.append(title)
        if updated != original or target_type != publication_type:
            stats.changed.append(title)
        output[target_type].append(updated)

    final_titles = {
        normalize_title(publication.get("title", ""))
        for section in PUBLICATION_TYPES
        for publication in output[section]
    }

    for normalized, publication in scholar_by_title.items():
        if normalized in existing_titles:
            continue

        try:
            filled = fill_publication(publication)
        except Exception as exc:
            raise UpdateError(
                f"Could not retrieve details for '{scholar_title(publication)}': {exc}"
            ) from exc

        record = publication_from_scholar(filled)
        publication_id = scholar_id(filled) or scholar_id(publication)
        override = override_for(record["title"], publication_id, overrides)
        record, publication_type, excluded = apply_override(
            record,
            "unclassified",
            override,
            allow_unclassified=True,
        )

        if excluded:
            stats.excluded.append(record["title"])
            continue

        if publication_type == "unclassified":
            stats.unclassified.append(record["title"])
            continue

        final_normalized = normalize_title(record["title"])
        if final_normalized in final_titles:
            stats.duplicates.append(record["title"])
            continue

        output[publication_type].append(record)
        final_titles.add(final_normalized)
        stats.added.append(record["title"])

    for section in PUBLICATION_TYPES:
        output[section].sort(key=sort_key)

    stats.final_count = publication_count(output)
    validate_publication_data(output, stats.existing_count)
    return output, stats


def write_atomically(path: Path, data: dict[str, Any]) -> None:
    """Write, re-read, validate, and atomically replace publications.json."""
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=".publications.", suffix=".tmp", dir=path.parent, text=True
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())

        validated = load_json(temporary_path)
        validate_publication_data(validated, publication_count(load_json(path)))
        os.replace(temporary_path, path)
    finally:
        if temporary_path.exists():
            temporary_path.unlink()


def print_list(label: str, values: list[str]) -> None:
    print(f"{label}: {len(values)}")
    for value in values:
        print(f"  - {value}")


def print_report(stats: UpdateStats, dry_run: bool) -> None:
    print("\nPublication update preview" if dry_run else "\nPublication update complete")
    print(f"Existing publication count: {stats.existing_count}")
    print(f"Scholar publication count: {stats.scholar_count}")
    print(f"Final merged publication count: {stats.final_count}")
    print_list("Publications that would be added" if dry_run else "Publications added", stats.added)
    print_list("Manually preserved publications", stats.manually_preserved)
    print_list("Duplicates detected", stats.duplicates)
    print_list("Excluded publications", stats.excluded)
    print_list(
        "Unclassified Scholar records not added to publications.json",
        stats.unclassified,
    )
    print_list("Publications with metadata changes", stats.changed)
    if dry_run:
        print("\nDry run only: data/publications.json was not modified.")


def run_update(dry_run: bool = False) -> UpdateStats:
    existing_data = load_json(PUBLICATIONS_PATH)
    validate_publication_data(existing_data, 0)
    overrides = load_overrides()
    scholar_publications, fill_publication = fetch_scholar_publications()
    updated_data, stats = build_updated_data(
        existing_data,
        scholar_publications,
        fill_publication,
        overrides,
    )

    if not dry_run:
        write_atomically(PUBLICATIONS_PATH, updated_data)
    print_report(stats, dry_run)
    return stats


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        run_update(dry_run=args.dry_run)
    except UpdateError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        print("data/publications.json was not modified.", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\nUpdate cancelled; data/publications.json was not modified.", file=sys.stderr)
        return 130
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
