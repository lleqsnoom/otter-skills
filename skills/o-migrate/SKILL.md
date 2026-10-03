---
name: o-migrate
description: Plan a framework or dependency upgrade — inventory declared and installed versions, read each crossed major's official upgrade guide, list every breaking change with its URL and where the project uses it, and order the steps one major at a time. Use when asked to upgrade, bump or migrate a package or framework (Express 4 → 5, React 18 → 19).
version: 2.1.0
author: Community
tags: [migration, upgrade, dependency-management, framework-migration, version-upgrade]
user-invocable: true
---

# O-Migrate — Migration Planning

A migration plan is only as true as its sources. This skill carries no list of breaking changes of its own: every
change in the plan comes from the official upgrade guide or changelog of the major version it belongs to, and
names that page by URL. A change you cannot source is not in the plan — say it is unknown instead.

`<skill>` below is this skill's folder.

## 1. Inventory — what the project actually runs

From the project root:

```bash
node <skill>/scripts/analyze.mjs --target express@5 [--output <run folder>/E<nn>-migration-plan.md]
node <skill>/scripts/analyze.mjs --target django@latest --online   # ask the registry for the latest version
node <skill>/scripts/analyze.mjs --all [--online]                  # every declared dependency
```

It reads npm (`package.json`, `node_modules`, `package-lock.json`), Python (`requirements.txt`,
`pyproject.toml` with its extras, dependency groups and Poetry groups, `poetry.lock` / `uv.lock`), Cargo
(`Cargo.toml` and every workspace member's, `Cargo.lock`) and Go (`go.mod`), and prints
JSON: `inventory[]` (`ecosystem`, `name`, `declared`, `installed`, `from`, `target`, `majorsCrossed`, and with
`--online` the `latest` version and the `links` where its changelog lives) and `plan[]` — one step per major
crossed, each with `source: null` and an empty `changes` list for you to fill. `problems[]` says what it could not
decide: a target such as `latest` without `--online`, a registry that could not be reached, or a package the
project does not use. Other ecosystems (Maven, NuGet) get the same inventory by hand.

## 2. Sources — one official guide per major crossed

For each step, fetch the package's own upgrade guide or changelog for that major (its docs site, its
`CHANGELOG.md`, its GitHub release notes) and record the URL as the step's source. Prefer the maintainers' page
over a blog post. Two majors crossed means two guides: a guide for 5 does not cover the move from 3 to 4.

## 3. Impact — where this project uses each change

For every breaking change the guide lists, search the project for the API it touches and record each hit as
`file:line`. A change with no hit is listed with `not used here`, so the reader can see it was checked. Note a
codemod when the guide names one, and which changes it covers.

## 4. Order — one major at a time

Order the steps so each major lands on its own, with the full test suite green before the next: runtime and
tooling requirements first (Node version, compiler), then codemods, then the hand edits, then deprecations that
will break in the next major.

## Definition of Done

- The plan names, for every major crossed, the official source it was built from, by URL.
- Every breaking change in it carries where this project uses it (`file:line`), or `not used here`.
- Nothing in the plan is unsourced: a change you could not confirm is marked unknown, never filled in from memory.
- `analyze.mjs` exits 0 with the inventory; it exits 1, with a message, on no `--target`/`--all` or no readable
  `package.json`.
