# Repository Guidelines

## Project Status & Structure

This directory is currently an empty project scaffold. No source code, tests, assets, dependency manifests, or Git metadata are present. Update this guide when the initial implementation establishes the project’s language and tooling.

For new modules, use a clear layout such as `src/` for application code, `tests/` for automated tests, `docs/` for documentation, and `assets/` for static resources. Create only directories the implementation needs. Group related functionality together and keep module responsibilities focused.

## Build, Test, and Development Commands

No build, test, or local development commands are configured yet. When adding tooling, document the exact setup, run, test, and lint commands in `README.md`, including required runtime versions. Keep those commands consistent with the dependency manifest and CI configuration. Do not assume commands such as `npm test` or `make build` work until their configuration exists.

## Coding Style & Naming Conventions

Follow the selected language’s standard conventions and configure its formatter and linter when introducing the first source files. Keep indentation consistent within each file. Use descriptive names for modules, functions, and variables; avoid unexplained abbreviations. Prefer small functions and explicit interfaces over unnecessary abstractions.

## Testing Guidelines

No testing framework or coverage threshold is established. Introduce tests alongside meaningful behavior changes, covering expected outcomes, edge cases, and failure paths. Use descriptive test names and the chosen framework’s discovery convention. Keep tests deterministic and document how contributors can run them locally.

## Commit & Pull Request Guidelines

No Git history is available to establish existing commit conventions. Use concise, imperative commit subjects, such as `Add configuration loader`. Keep each commit focused on one coherent change.

Pull requests should describe the problem, summarize the resulting behavior, link relevant issues, and report validation performed. Include screenshots for visible UI changes when applicable.

## Security & Configuration

Never commit credentials, access tokens, or private configuration. Provide placeholder values in an example configuration file and document required environment variables as integrations are introduced.
