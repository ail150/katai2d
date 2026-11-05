# Corpus Examples in the Web UI

## Intent

Make all 26 files in `tests/corpus` selectable as ready-made project examples in the workbench. Choosing an example should import it as a server project and return the user to Input.

## Approach

Bundle the fixture JSON into the frontend using Vite's raw glob import. Add a top-level **Examples** menu with one selectable entry per fixture, using each fixture's project name. Keep the existing Tutorial 1 entries in File. Limit the popup height and allow scrolling. Selecting an example sends its parsed JSON through the existing project import API and follows the current example-loading behavior.

This avoids duplicate fixture copies and needs no new server endpoint. The corpus remains the source of truth for the examples.

## Scope and constraints

- Include every `*.k2d` file in `tests/corpus`, sorted by name for stable menu ordering.
- Preserve current tutorial examples and project import behavior.
- Test that all 26 entries appear, and selecting each loads the matching project name and saved input.
- Do not calculate examples automatically or change fixture contents.
