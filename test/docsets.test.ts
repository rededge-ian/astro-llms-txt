import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { entryToSimpleMarkdown } from "../src/entryToSimpleMarkdown.ts";
import astroLlmsTxt from "../src/index.ts";

interface FixturePage {
  description: string;
  html: string;
  outputPath?: string;
  pathname: string;
}

interface BuildOutputs {
  full: string;
  llms: string;
  logs: {
    error: string[];
    log: string[];
    warn: string[];
  };
  small: string;
}

const fixturePages: FixturePage[] = [
  {
    pathname: "",
    description: "Root summary",
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
    description: "Guide summary",
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
  {
    pathname: "docs/spacing-links/",
    description: "Spacing summary",
    html: buildHtmlDocument({
      description: "Spacing summary",
      title: "Why brands move to Shipfluence",
      titleHtml: "Why brands move<br>to Shipfluence",
      body: `
        <p>Spacing across <span>inline</span> <span>nodes</span> stays readable.</p>
        <p>Punctuation <span>stays</span><span>tight</span><span>.</span></p>
        <h2>Why brands move<br>to Shipfluence</h2>
        <p><a href="/for-creators">For creators </a><a href="/locations/dc-metro">DC metro fulfillment </a><a href="/integrations">Integrations </a><a href="/industries/government-affairs">Government affairs</a></p>
      `,
    }),
  },
  {
    pathname: "docs/embed-cleanup/",
    description: "Embed cleanup summary",
    html: buildHtmlDocument({
      description: "Embed cleanup summary",
      title: "Embed cleanup",
      body: `
        <p>Editorial copy that should remain.</p>
        <p>Prefer the source? <a href="https://www.instagram.com/p/example-post/">View the Instagram post</a></p>
        <p><a href="https://example.com/report">Read the underlying report</a> for full methodology.</p>
      `,
    }),
  },
  {
    pathname: "404/",
    outputPath: "404.html",
    description: "Missing page summary",
    html: buildHtmlDocument({
      description: "Missing page summary",
      title: "Not Found",
      body: `
        <p>This page should stay out of llms outputs.</p>
      `,
    }),
  },
];

test("spacing stays readable across split inline nodes in titles and headings", async t => {
  const { full, llms, small } = await runFixtureBuild(t);

  assert.ok(full.includes("# Why brands move to Shipfluence"));
  assert.ok(small.includes("# Why brands move to Shipfluence"));
  assert.ok(small.includes("## Why brands move to Shipfluence"));
  assert.ok(llms.includes("- [Why brands move to Shipfluence](https://example.com/product/docs/spacing-links/): Spacing summary"));
  assert.ok(full.includes("Punctuation stays tight."));

  assert.ok(!full.includes("moveto"));
  assert.ok(!small.includes("moveto"));
  assert.ok(!llms.includes("moveto"));
  assert.ok(!full.includes("tight ."));
});

test("entryToSimpleMarkdown preserves whitespace across br in headings", async () => {
  const markdown = await entryToSimpleMarkdown("<h2>Why brands move<br>to Shipfluence</h2>");

  assert.equal(markdown, "## Why brands move to Shipfluence");
});

test("entryToSimpleMarkdown preserves whitespace across br in paragraphs", async () => {
  const markdown = await entryToSimpleMarkdown("<p>Hello<br>world</p>");

  assert.equal(markdown, "Hello world");
});

test("entryToSimpleMarkdown keeps punctuation tight across br boundaries", async () => {
  const exclamation = await entryToSimpleMarkdown("<p>Hello<br>!</p>");
  const comma = await entryToSimpleMarkdown("<p>Hello<br>, world</p>");

  assert.equal(exclamation, "Hello!");
  assert.equal(comma, "Hello, world");
});

test("adjacent sibling links serialize with stable readable separation", async t => {
  const { full } = await runFixtureBuild(t);

  assert.ok(
    full.includes(
      "[For creators](/for-creators) [DC metro fulfillment](/locations/dc-metro) [Integrations](/integrations) [Government affairs](/industries/government-affairs)",
    ),
  );
  assert.ok(!full.includes("](/for-creators)["));
  assert.ok(!full.includes("](/locations/dc-metro)["));
});

test("ancillary social embed fallback copy is removed while real content remains", async t => {
  const { full } = await runFixtureBuild(t);

  assert.ok(full.includes("Editorial copy that should remain."));
  assert.ok(full.includes("[Read the underlying report](https://example.com/report) for full methodology."));
  assert.ok(!full.includes("Prefer the source?"));
  assert.ok(!full.includes("View the Instagram post"));
});

test("404 pages emitted as 404.html are excluded without false missing-file warnings", async t => {
  const { full, llms, logs, small } = await runFixtureBuild(t);

  assert.ok(!full.includes("# Not Found"));
  assert.ok(!small.includes("# Not Found"));
  assert.ok(!llms.includes("[Not Found]("));
  assert.ok(!logs.warn.some(line => line.includes("404/index.html")));
  assert.ok(!logs.error.some(line => line.includes("404/index.html")));
  assert.ok(!logs.error.some(line => line.includes("File not found")));
});

test("homepage-first ordering and current noise-removal behavior do not regress", async t => {
  const { full, llms, small } = await runFixtureBuild(t);

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

  assert.match(small, /## Start here/);
  assert.match(small, /[*-] Create an account/);
  assert.match(small, /## Getting Started/);
  assert.match(small, /[*-] Install the package/);
  assert.ok(!small.includes("Welcome to the Example docs."));
  assert.ok(!small.includes("Meaningful content stays here."));

  assert.ok(!full.includes("<!--"));
  assert.ok(!full.includes("Hero image"));
  assert.ok(!full.includes("Pricing image"));
  assert.ok(!full.includes("Decorative hidden text"));
  assert.ok(full.includes("Meaningful content stays here."));
  assert.ok(full.includes("[Sign up](https://example.com/signup) for updates."));

  assert.ok(full.includes("URL: https://example.com/product/docs/guide/"));
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
    const htmlPath = page.outputPath
      ? path.join(distDir, page.outputPath)
      : path.join(distDir, page.pathname, "index.html");
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

  const logs = captureConsole();
  try {
    await buildDoneHook({
      dir: { pathname: distDir },
      pages: fixturePages.map(page => ({ pathname: page.pathname })),
    } as never);
  } finally {
    logs.restore();
  }

  return {
    full: await fs.readFile(path.join(distDir, "llms-full.txt"), "utf-8"),
    llms: await fs.readFile(path.join(distDir, "llms.txt"), "utf-8"),
    logs,
    small: await fs.readFile(path.join(distDir, "llms-small.txt"), "utf-8"),
  };
}

function captureConsole() {
  const logs = {
    error: [] as string[],
    log: [] as string[],
    warn: [] as string[],
  };

  const original = {
    error: console.error,
    log: console.log,
    warn: console.warn,
  };

  console.error = (...args: unknown[]) => {
    logs.error.push(args.map(arg => String(arg)).join(" "));
  };
  console.log = (...args: unknown[]) => {
    logs.log.push(args.map(arg => String(arg)).join(" "));
  };
  console.warn = (...args: unknown[]) => {
    logs.warn.push(args.map(arg => String(arg)).join(" "));
  };

  return {
    ...logs,
    restore() {
      console.error = original.error;
      console.log = original.log;
      console.warn = original.warn;
    },
  };
}

function buildHtmlDocument(args: {
  body: string;
  description: string;
  title: string;
  titleHtml?: string;
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
      <h1>${args.titleHtml ?? args.title}</h1>
      ${args.body}
    </main>
    <footer>Shared footer</footer>
  </body>
</html>`;
}
