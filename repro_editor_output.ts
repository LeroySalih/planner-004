import { marked } from "marked";

// Simulate what RichTextEditor might output when a user 'types' a markdown table
// contentEditable often wraps lines in divs or paragraphs.
const editorOutput1 =
    `<div>| Header 1 | Header 2 |</div><div>| --- | --- |</div><div>| Cell 1 | Cell 2 |</div>`;

const editorOutput2 =
    `<p>| Header 1 | Header 2 |</p><p>| --- | --- |</p><p>| Cell 1 | Cell 2 |</p>`;

// Also simple plain text to compare
const plainMarkdown = `
| Header 1 | Header 2 |
| --- | --- |
| Cell 1 | Cell 2 |
`;

const editorOutput3 =
    `<div>\`\`\`javascript</div><div>const x = 1;</div><div>console.log(x);</div><div>\`\`\`</div>`;

function unwrapHtml(html: string) {
    let cleaned = html ? html.replace(/&nbsp;/g, " ") : "";
    cleaned = cleaned.replace(/<\/div>/g, "\n")
        .replace(/<\/p>/g, "\n")
        .replace(/<br\s*\/?>/g, "\n");
    cleaned = cleaned.replace(/<div>/g, "")
        .replace(/<p>/g, "");
    return cleaned;
}

function testParse(name: string, content: string) {
    console.log(`--- Testing ${name} ---`);
    try {
        const unwrapped = unwrapHtml(content);
        console.log("Unwrapped content:\n", unwrapped);
        const html = marked.parse(unwrapped, { async: false });
        console.log("Parsed HTML:\n", html);
    } catch (e) {
        console.error(e);
    }
}

testParse("Wrapped in DIVs", editorOutput1);
testParse("Wrapped in Ps", editorOutput2);
testParse("Plain Markdown", plainMarkdown);
testParse("Code Block in DIVs", editorOutput3);
