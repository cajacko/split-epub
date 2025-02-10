const fs = require("fs-extra");
const path = require("path");
const EPub = require("epub2").EPub;
const EpubGen = require("epub-gen");

const FILE_SIZE_LIMIT = 1 * 1024 * 1024; // 1MB limit (Adjust as needed)
const INPUT_FILE = "../Worth The Candle.epub"; // Change this to your input EPUB file

// Helper function to promisify getChapterRaw
function getChapterContent(epub, chapterId) {
  return new Promise((resolve, reject) => {
    epub.getChapterRaw(chapterId, (err, text) => {
      if (err) {
        reject(err);
      } else {
        // Strip out image tags (basic regex, may not catch all cases)
        const cleanText = text.replace(/<img[^>]*>/g, "");
        resolve(cleanText);
      }
    });
  });
}

async function splitEpub(filePath) {
  return new Promise((resolve, reject) => {
    const epub = new EPub(filePath);

    epub.on("end", async () => {
      const bookTitle = epub.metadata.title
        .replace(/[^a-zA-Z0-9 ]/g, "")
        .trim(); // Clean title

      // Normalize TOC mappings by decoding the keys
      const chapterTitles = {};
      epub.toc.forEach((entry) => {
        const decodedHref = decodeURIComponent(entry.href); // Fix encoded spaces (%20) and other characters
        chapterTitles[decodedHref] = entry.title;
      });

      let currentSize = 0;
      let currentPart = [];
      let partNumber = 1;

      const savePart = async () => {
        if (currentPart.length === 0) return;

        const outputFileName = `${bookTitle} - Part ${partNumber}.epub`;
        console.log(`Saving: ${outputFileName}`);

        // Generate EPUB for this chunk
        await new EpubGen(
          {
            title: `${bookTitle} - Part ${partNumber}`,
            content: currentPart.map((ch) => ({
              title: ch.title,
              data: ch.content,
            })),
          },
          outputFileName
        ).promise;

        partNumber++;
        currentPart = [];
        currentSize = 0;
      };

      for (const ch of epub.flow) {
        try {
          // Skip images or non-text files
          if (
            ch.href.endsWith(".jpg") ||
            ch.href.endsWith(".png") ||
            ch.href.endsWith(".gif")
          ) {
            console.warn(`Skipping image: ${ch.href}`);
            continue;
          }

          const content = await getChapterContent(epub, ch.id);

          // Normalize the href for lookup
          const normalizedHref = decodeURIComponent(ch.href);

          // Get the actual title from the TOC mapping, fallback to default
          const title = chapterTitles[normalizedHref] || ch.title || "Untitled";

          const chapter = { title, content };
          const chapterSize = Buffer.byteLength(chapter.content, "utf-8");

          // If adding this chapter exceeds the file size limit, save the current part and start a new one
          if (currentSize + chapterSize > FILE_SIZE_LIMIT) {
            await savePart();
          }

          // Add the chapter
          currentPart.push(chapter);
          currentSize += chapterSize;
        } catch (error) {
          console.error(`Failed to process chapter ${ch.href}:`, error);
        }
      }

      // Save the last part
      await savePart();
      resolve();
    });

    epub.on("error", reject);
    epub.parse();
  });
}

// Run the function
splitEpub(INPUT_FILE)
  .then(() => console.log("EPUB split completed!"))
  .catch(console.error);
