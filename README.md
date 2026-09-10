# emilf.dev

Personal homepage and blog for Emil Friðriksson — a static site built with
[Eleventy](https://www.11ty.dev/) and deployed to GitHub Pages via GitHub
Actions.

Live at <https://emilf.dev>.

## Structure

- `src/` — site source (templates, Markdown, assets)
  - `src/index.njk` — homepage
  - `src/about.md`, `src/blog.md`, `src/projects.md` — top-level pages
  - `src/blog/` — blog posts (Markdown)
  - `src/projects/` — project pages (Markdown)
  - `src/_includes/` — layouts and partials
  - `src/_data/site.json` — site metadata
  - `src/assets/` — CSS, images
  - `src/CNAME` — custom domain, carried into the build output
- `_site/` — build output (generated, not committed)

## Development

```sh
npm install
npm run start   # local dev server with live reload
npm run build   # one-off build into _site/
```

## Deployment

Pushes to `master` trigger `.github/workflows/pages.yml`, which builds the
site and publishes it to GitHub Pages. The Pages source is set to
"GitHub Actions" (not a branch).
