import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import astroLlmsTxt from "../src/index.ts";

interface FixturePage {
  html: string;
  pathname: string;
}

interface BuildOutputs {
  full: string;
  llms: string;
  small: string;
}

const fixturePages: FixturePage[] = [
  {
    pathname: "",
    html: buildHtmlDocument({
      description: "Root summary",
      title: "Home",
      body: `
        <p>Welcome to the Example docs.</p>
        <div class="outer">
          <section>
            <div>
              <h2>Start here</h2>
              <ul>
                <li>Create an account</li>
                <li>Read the guide</li>
              </ul>
            </div>
          </section>
        </div>
      `,
    }),
  },
  {
    pathname: "docs/guide/",
    html: buildHtmlDocument({
      description: "Guide summary",
      title: "Guide",
      body: `
        <div class="content-shell">
          <section>
            <div class="stack">
              <h2>Getting Started</h2>
              <div class="nested-list">
                <ul>
                  <li>Install the package</li>
                  <li>Configure the plugin</li>
                </ul>
              </div>
            </div>
          </section>
        </div>
        <p>Meaningful content stays here.</p>
        <!-- Remove this comment -->
        <p><img src="/hero.png" alt="Hero image"></p>
        <p><a href="https://example.com/pricing"><img src="/pricing.png" alt="Pricing image"></a></p>
        <div aria-hidden="true">Decorative hidden text</div>
        <p><a href="https://example.com/signup">Sign up</a> for updates.</p>
      `,
    }),
  },
];

test("docset outputs include the homepage first as intro context", async t => {
  const { full, small } = await runFixtureBuild(t);

  assert.ok(full.startsWith("<SYSTEM>Full site docset</SYSTEM>\n\n> Root summary"));
  assert.ok(small.startsWith("<SYSTEM>Small site docset</SYSTEM>\n\n> Root summary"));

  const homeUrl = "URL: https://example.com/product/";
  const guideHeading = "# Guide";
  assert.ok(full.includes(homeUrl));
  assert.ok(small.includes(homeUrl));
  assert.ok(full.indexOf(homeUrl) < full.indexOf(guideHeading));
  assert.ok(small.indexOf(homeUrl) < small.indexOf(guideHeading));

  assert.ok(!full.includes("\n# Home\n"));
  assert.ok(!small.includes("\n# Home\n"));
});

test("llms-small preserves nested headings and lists", async t => {
  const { small } = await runFixtureBuild(t);

  assert.match(small, /## Start here/);
  assert.match(small, /[*-] Create an account/);
  assert.match(small, /## Getting Started/);
  assert.match(small, /[*-] Install the package/);
  assert.ok(!small.includes("Welcome to the Example docs."));
  assert.ok(!small.includes("Meaningful content stays here."));
});

test("llms-full removes comments and image noise while keeping useful text", async t => {
  const { full } = await runFixtureBuild(t);

  assert.ok(!full.includes("<!--"));
  assert.ok(!full.includes("Hero image"));
  assert.ok(!full.includes("Pricing image"));
  assert.ok(!full.includes("Decorative hidden text"));

  assert.ok(full.includes("Meaningful content stays here."));
  assert.ok(full.includes("[Sign up](https://example.com/signup) for updates."));
});

test("generated URLs use the configured site and base, and llms.txt stays page-index oriented", async t => {
  const { full, llms, small } = await runFixtureBuild(t);

  assert.ok(full.includes("URL: https://example.com/product/"));
  assert.ok(full.includes("URL: https://example.com/product/docs/guide/"));
  assert.ok(small.includes("URL: https://example.com/product/"));
  assert.ok(small.includes("URL: https://example.com/product/docs/guide/"));

  assert.ok(llms.includes("## Docs"));
  assert.ok(llms.includes("- [Guide](https://example.com/product/docs/guide/): Guide summary"));
  assert.ok(!llms.includes("- [Home](https://example.com/product/): Root summary"));
  assert.ok(llms.includes("## Optional"));
  assert.ok(llms.includes("- [Full site](https://example.com/product/llms-full.txt): Full site docset"));
  assert.ok(llms.includes("- [Small site](https://example.com/product/llms-small.txt): Small site docset"));
});

async function runFixtureBuild(t: TestContext): Promise<BuildOutputs> {
  const distDir = await fs.mkdtemp(path.join(os.tmpdir(), "astro-llms-txt-"));
  t.after(async () => {
    await fs.rm(distDir, { recursive: true, force: true });
  });

  for (const page of fixturePages) {
    const htmlPath = path.join(distDir, page.pathname, "index.html");
    await fs.mkdir(path.dirname(htmlPath), { recursive: true });
    await fs.writeFile(htmlPath, page.html, "utf-8");
  }

  const integration = astroLlmsTxt({
    title: "Example Docs",
    description: "Generated fixture output",
    docSet: [
      {
        title: "Full site",
        description: "Full site docset",
        url: "/llms-full.txt",
        include: ["**"],
      },
      {
        title: "Small site",
        description: "Small site docset",
        url: "/llms-small.txt",
        include: ["**"],
        onlyStructure: true,
      },
    ],
    indexSections: [
      {
        title: "Docs",
        include: ["**"],
      },
    ],
  });

  const setupHook = integration.hooks["astro:config:setup"];
  const buildDoneHook = integration.hooks["astro:build:done"];
  assert.ok(setupHook);
  assert.ok(buildDoneHook);

  setupHook({
    config: {
      base: "/product/",
      site: new URL("https://example.com"),
    },
  } as never);

  await buildDoneHook({
    dir: { pathname: distDir },
    pages: fixturePages.map(page => ({ pathname: page.pathname })),
  } as never);

  return {
    full: await fs.readFile(path.join(distDir, "llms-full.txt"), "utf-8"),
    llms: await fs.readFile(path.join(distDir, "llms.txt"), "utf-8"),
    small: await fs.readFile(path.join(distDir, "llms-small.txt"), "utf-8"),
  };
}

function buildHtmlDocument(args: {
  body: string;
  description: string;
  title: string;
}): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="description" content="${args.description}">
    <title>${args.title}</title>
  </head>
  <body>
    <header>Shared header</header>
    <main>
      <h1>${args.title}</h1>
      ${args.body}
    </main>
    <footer>Shared footer</footer>
  </body>
</html>`;
}
