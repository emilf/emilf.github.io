// emilf.dev — Eleventy configuration
import eleventyNavigationPlugin from "@11ty/eleventy-navigation";
import rssPlugin from "@11ty/eleventy-plugin-rss";

export default async function (eleventyConfig) {
  eleventyConfig.addPlugin(eleventyNavigationPlugin);
  eleventyConfig.addPlugin(rssPlugin);

  // Copy static assets straight through
  eleventyConfig.addPassthroughCopy("src/assets");
  eleventyConfig.addPassthroughCopy("src/favicon.svg");
  eleventyConfig.addPassthroughCopy("src/CNAME");

  // Watch blog posts in dev
  eleventyConfig.addWatchTarget("./src/assets/css/");

  // Collections
  eleventyConfig.addCollection("posts", (collection) => {
    return [...collection.getFilteredByGlob("./src/blog/**/*.md")].reverse();
  });

  eleventyConfig.addCollection("nav", (collection) => {
    const pages = collection
      .getAll()
      .filter((p) => p.data.eleventyNavigation)
      .sort((a, b) =>
        (a.data.eleventyNavigation.order || 0) -
        (b.data.eleventyNavigation.order || 0)
      );
    return pages;
  });

  // Filters
  eleventyConfig.addFilter("readableDate", (value) => {
    const d = value instanceof Date ? value : new Date(value);
    return d.toLocaleDateString("en-GB", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  });

  eleventyConfig.addFilter("dateToISO", (value) => {
    const d = value instanceof Date ? value : new Date(value);
    return d.toISOString();
  });

  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      layouts: "_includes/layouts",
      data: "_data",
    },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
    templateFormats: ["md", "njk", "html"],
  };
}
