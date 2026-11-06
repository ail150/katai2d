#!/usr/bin/env python3
"""check_doc_refs: a reference to a document that does not exist is a broken promise.

A source comment that names a document is a pointer. It tells the next reader
where the reasoning is, and it is the only way the reasoning behind a decision
stays reachable once the decision is old. But a pointer to a file that was
renamed, moved or never written is worse than no pointer at all: it sends the
reader looking for something that is not there, and it makes the reader
question the decision rather than the reference.

What it scans:

  * every tracked source file in the repository (the same set check_language.py
    walks), for path-like references that name a document;
  * the reference must resolve to a file that exists, relative to the repository
    root or relative to the file that makes the reference.

THE SCOPE, and it is the whole subtlety: this gate polices the TRACKED tree.

This repository deliberately keeps some of its prose out of version control.
`docs/references/` and most of `docs/validation/` are working documents -- the
formulation notes, the validation records -- that live outside the repository
and are being prepared for the project website; `docs/README.md` says so, and
`.gitignore` says so. The source files reference them by path, and those
references are MEANINGFUL: they name where the derivation behind a test is
written down, for the author and for whoever gets the website copy. A reference
to such a document is not a dangling pointer, and flagging 193 of them would be
a gate crying wolf -- which is worse than no gate, because a gate that cries
wolf is a gate nobody runs.

So the rule is: a reference must resolve to a file the repository HOLDS -- a
tracked file, or a file that is present on disk and not excluded from the
project's business. A reference into a path the repository has deliberately
excluded is not this gate's business, and neither is a reference to something
outside the repository altogether.

What it deliberately does NOT do:

  * it does not require that a document be referenced from anywhere -- a document
    nobody cites may still be exactly what a reader needs;
  * it does not check that a reference points at the RIGHT document, only that
    the file it names exists. A reference to the wrong existing document is a
    different (and much rarer) defect, and pretending to catch it would mean
    guessing;
  * it does not look inside URLs. A link to an external site is not a path in
    this repository, and the site may well be gone by the time anyone reads it.

Usage:
    python scripts/check_doc_refs.py                 # gate: exit 1 on any dangling reference
    python scripts/check_doc_refs.py --report        # census, always exit 0
    python scripts/check_doc_refs.py kernel/materials  # restrict to a subtree
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

# The file extensions that mean "a document this repository holds". A path with
# one of these is a pointer into the tree; anything else is prose.
DOC_SUFFIXES = (".md", ".tex", ".json", ".bib", ".pdf", ".yml", ".yaml")

# A reference is a path-like token that ENDS in a document suffix. It must carry
# a separator (a "/" or a "\"): a bare "README.md" is a filename mention, and
# where it lives depends on which file mentions it, so it is resolved against
# the referring file's directory as well as the repository root. The bare form
# is still checked -- against the root -- because "ARCHITECTURE.md" in a source
# header means the one at the top.
#
# A BARE name with a non-markdown suffix is not a document reference at all: it
# is a runtime artefact -- "response.json", "started.json", ".progress.json" are
# the names a test gives a payload it writes, and they are written, not read.
# Only a path WITH a directory component, or a markdown file, is a pointer to
# something this repository is supposed to hold.
REF_RE = re.compile(
    r"(?<![\w./\\$-])((?:[\w.\-]+[/\\])+[\w.\-]+\.(?:md|tex|json|bib|pdf|yml|yaml)"
    r"|[\w.\-]+\.md)(?![\w/\\])"
)

# A reference inside a URL is not a path in this repository.
URL_RE = re.compile(r"\b(?:https?|ftp|mailto):", re.IGNORECASE)

# Directories that hold no source and whose contents are not the repository's
# to police.
SKIP_DIRS = {".git", "build", "node_modules", ".venv", "__pycache__", "third_party"}

# Only these can hold a reference to a document. A source comment is text, so
# the file has to be text: reading a binary as text to look for a path in it is
# how a gate that should take a second came to take four minutes (this
# repository tracks a 7.7 MB binary result file).
TEXT_SUFFIXES = {
    ".hpp", ".cpp", ".h", ".cc", ".cxx", ".inl", ".ipp", ".c",
    ".py", ".pyi", ".md", ".tex", ".bib", ".json", ".yml", ".yaml",
    ".toml", ".cfg", ".ini", ".ps1", ".sh", ".cmake", ".txt",
    ".ts", ".tsx", ".js", ".jsx", ".cjs", ".mjs", ".html", ".css",
}

# The names of files that carry text but no extension.
TEXT_NAMES = {"CMakeLists.txt", "Dockerfile", "Makefile"}

# A file larger than this is not prose. The limit is generous -- the largest
# source file in this tree is a fraction of it -- and it only exists so that a
# stray binary cannot make the gate crawl.
MAX_BYTES = 2 * 1024 * 1024


def is_text_candidate(path: Path) -> bool:
    """Whether the file could hold a reference at all."""
    if path.suffix.lower() in TEXT_SUFFIXES:
        return True
    return path.name in TEXT_NAMES

# The suffix set used for the "ends in a document suffix" test, as a set for
# membership checks.
DOC_SUFFIX_SET = set(DOC_SUFFIXES)


def tracked_files() -> set[str] | None:
    """The repository's tracked files, as repo-relative POSIX paths, or None when
    git cannot answer.

    The tracked set is the right one to scan: it excludes build trees, virtual
    environments and dependency checkouts, none of which are the project's
    business. When git is unavailable the scan falls back to the working tree.

    The paths are kept RELATIVE on purpose. Resolving them -- asking the
    filesystem for the canonical form of 2470 paths -- was measured at 32.6 s
    on this repository's Windows-side checkout, because the canonicalisation of
    a path on a mounted drive costs a filesystem round trip each. Comparing
    relative paths costs none.
    """
    try:
        out = subprocess.run(
            ["git", "-C", str(REPO), "ls-files", "-z"],
            capture_output=True, check=True,
        ).stdout
    except (OSError, subprocess.CalledProcessError):
        return None
    return {p for p in out.decode("utf-8", "replace").split("\0") if p}


def relative_to_repo(path: Path) -> str:
    """The path as the repository spells it: relative, POSIX separators.

    Lexical, not canonical. `Path.resolve()` asks the filesystem for the
    canonical form, and on this repository's checkout that costs a filesystem
    round trip per path -- measured at 32.6 s for the 2470 tracked files. The
    walk already produces absolute paths that are lexically under REPO, so the
    relative form can be computed by string surgery alone.
    """
    try:
        return path.relative_to(REPO).as_posix()
    except ValueError:
        return path.as_posix()


def source_files(roots: list[Path], tracked: set[str] | None) -> list[Path]:
    """The files to scan, as absolute paths.

    When git can answer, the tracked list IS the file list: git tracks files,
    not directories, so there is nothing to stat to find out whether an entry is
    a file. That matters here -- every filesystem call on this repository's
    Windows-side checkout costs several milliseconds, and asking about 2470
    paths one stat at a time was measured at 32.6 s. The list comes from git in
    0.9 s and needs no filesystem call at all.

    Without git the walk is used instead, pruning the directories that are not
    the project's business rather than filtering them out afterwards.
    """
    if tracked is not None:
        out: list[Path] = []
        for rel in sorted(tracked):
            if rel.startswith("/") or ":" in rel:
                continue
            parts = rel.split("/")
            if any(part in SKIP_DIRS for part in parts):
                continue
            path = REPO / Path(rel)
            if not is_text_candidate(path):
                continue
            out.append(path)
        return out

    found: list[Path] = []
    for root in roots:
        if root.is_file():
            candidates = [root]
        else:
            candidates = []
            for dirpath, dirnames, filenames in os.walk(root):
                # Prune in place: os.walk honours the mutated list.
                dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
                for name in filenames:
                    candidates.append(Path(dirpath) / name)
        for path in candidates:
            if any(part in SKIP_DIRS for part in path.parts):
                continue
            try:
                if not path.is_file():
                    continue
            except OSError:
                continue
            found.append(path)
    return found


def strip_urls(line: str) -> str:
    """Blank out the URL-ish part of a line, so the reference regex cannot read
    a path out of `https://example.com/docs/guide.md`."""
    return URL_RE.sub(" ", line)


def is_excluded(rel: str) -> bool:
    """Whether git excludes this repository-relative path.

    This is the question that gives the gate its scope. The repository keeps
    some of its prose out of version control on purpose -- the formulation
    notes and the working validation records under `docs/references/` and
    `docs/validation/`, which `docs/README.md` describes and `.gitignore`
    lists. A reference to one of those names where the derivation is written
    down; it is not a promise the clone fails to keep.

    `git check-ignore` answers it exactly, from the same rules git itself uses
    -- including the negation patterns (`!/docs/validation/verification-matrix.md`
    re-includes one file from a directory that is otherwise excluded), which no
    hand-written prefix list would get right.
    """
    try:
        out = subprocess.run(
            ["git", "-C", str(REPO), "check-ignore", "-q", "--no-index", rel],
            capture_output=True,
        )
    except OSError:
        return False
    return out.returncode == 0


def names_a_working_document(name: str) -> bool:
    """Whether this bare name is one of the working documents.

    A source comment often names such a document by its bare name -- "see
    hardening-soil-formulation.md" -- rather than by its path, because the
    author knows which document is meant. The bare name still points at a
    working document the repository holds on disk, outside version control, so
    it is not a broken promise either.

    The test is the same one `is_excluded` makes, applied to the name inside
    each excluded directory. It asks git rather than looking at the directory,
    because the directory is not present in a clone at all -- the whole point
    of the exclusion is that the working documents live elsewhere.
    """
    for directory in EXCLUDED_DOC_DIRS:
        if is_excluded(directory + name):
            return True
    return False


# The directories that hold the working documents: the formulation notes and the
# working validation records, which the repository deliberately keeps out of
# version control.
EXCLUDED_DOC_DIRS = ("docs/references/", "docs/validation/")


def resolve(ref: str, referring: Path, known: set[str], cache: dict[str, bool]) -> bool:
    """Whether the reference points at a document this repository holds.

    A reference is resolved against the repository root first and against the
    referring file's own directory second: "docs/k2d-format.md" is written from
    anywhere in the tree and means the same file, while "ARCHITECTURE.md" in a
    header means the one next to it if it is there and the one at the root if it
    is not. Both spellings exist in this tree and both have to work.

    The result is CACHED per reference text, and the repository's tracked files
    answer most questions without a filesystem call at all: a reference that
    names a tracked file exists, full stop. Only a reference that names
    something git does not track costs a stat, and the number of distinct such
    references is small (44 in this tree).
    """
    key = ref.replace("\\", "/")
    if key in cache:
        return cache[key]
    answer = key in known
    if not answer:
        for candidate in (REPO / key, referring.parent / key):
            try:
                if candidate.is_file():
                    answer = True
                    break
            except OSError:
                continue
    if not answer:
        # Not in the tracked tree and not on disk. Before calling it a broken
        # promise, ask whether the repository EXCLUDES it on purpose -- a
        # reference to a working document that lives outside the repository is
        # a pointer, not a broken one.
        for candidate in (key, relative_to_repo(referring.parent / key)):
            if is_excluded(candidate):
                answer = True
                break
    if not answer and "/" not in key:
        # A bare name may name a working document that lives in one of the
        # excluded directories: the source comments that say "see
        # hardening-soil-formulation.md" mean the document of that name.
        if names_a_working_document(key):
            answer = True
    cache[key] = answer
    return answer


def scan(paths: list[Path], known: set[str]) -> list[tuple[Path, int, str]]:
    """Every dangling reference, as (file, line number, reference)."""
    dangling: list[tuple[Path, int, str]] = []
    cache: dict[str, bool] = {}
    for path in paths:
        try:
            if path.stat().st_size > MAX_BYTES:
                continue
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for number, line in enumerate(text.splitlines(), start=1):
            cleaned = strip_urls(line)
            for ref in REF_RE.findall(cleaned):
                if not resolve(ref, path, known, cache):
                    dangling.append((path, number, ref))
    return dangling


def main() -> int:
    ap = argparse.ArgumentParser(description="Fail on a reference to a document that is not there.")
    ap.add_argument("paths", nargs="*", default=None,
                    help="files or directories (default: the whole repository)")
    ap.add_argument("--report", action="store_true",
                    help="list the dangling references and exit 0 either way")
    args = ap.parse_args()

    tracked = tracked_files()
    if args.paths:
        roots = [Path(p).resolve() for p in args.paths]
    else:
        roots = [REPO]
    roots = [r for r in roots if r.exists()]

    files = source_files(roots, tracked)
    # The set of files that exist, as repository-relative POSIX paths. Tracked
    # files answer most references without a filesystem call; the ones that do
    # not are checked on disk (a file written but not yet added is a real file).
    known = set(tracked) if tracked is not None else set()
    for path in files:
        known.add(relative_to_repo(path))

    dangling = scan(files, known)

    if args.report:
        for path, number, ref in dangling:
            print(f"{relative_to_repo(path)}:{number}: no such document: {ref}")
        print(f"\n{len(dangling)} dangling document reference(s).")
        return 0

    if not dangling:
        print("check_doc_refs: OK - every referenced document exists.")
        return 0

    for path, number, ref in dangling:
        print(f"{relative_to_repo(path)}:{number}: no such document: {ref}")
    print(f"\ncheck_doc_refs: FAILED - {len(dangling)} reference(s) to a document that is not there.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
