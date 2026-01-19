import { marked } from "marked";

const tableMarkdown = `
| Student Name | Assessment Score | Status      |
| :---         | :---:            | :---        |
| John Smith   | 85%              | Passed      |
| Jane Doe     | 92%              | Distinction |
`;

try {
    const html = marked.parse(tableMarkdown, { async: false });
    console.log("Output HTML:");
    console.log(html);
} catch (e) {
    console.error("Error parsing:", e);
}
