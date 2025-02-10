import { EPub } from "epub2";
import EpubGen from "epub-gen";
import fs from "fs-extra";
import path from "path";

const FILE_SIZE_LIMIT: number = 1 * 1024 * 1024; // 1MB limit (Adjust as needed)

// Get the input file from the command line arguments
const args = process.argv;
const INPUT_FILE: string = args[args.length - 1];

if (!INPUT_FILE || !INPUT_FILE.endsWith(".epub")) {
  console.error("Please provide a valid EPUB file as the last argument.");
  process.exit(1);
}

const inputDir = path.dirname(INPUT_FILE);
const fileName = path.basename(INPUT_FILE, ".epub");
const outputDir = path.join(inputDir, `${fileName} - Split`);

// Ensure output directory is clean
if (fs.existsSync(outputDir)) {
  fs.removeSync(outputDir);
}
fs.mkdirSync(outputDir);

interface Chapter {
  title: string;
  content: string;
}

// Helper function to promisify getChapterRaw
function getChapterContent(epub: EPub, chapterId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    epub.getChapterRaw(chapterId, (err, text) => {
      if (err) {
        reject(err);
      } else {
        // Strip out image tags (basic regex, may not catch all cases)
        const cleanText: string = text?.replace(/<img[^>]*>/g, "") ?? "";
        resolve(cleanText);
      }
    });
  });
}

async function splitEpub(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const epub: EPub = new EPub(filePath);

    epub.on("end", async () => {
      const bookTitle: string = epub?.metadata?.title
        ? epub.metadata.title.replace(/[^a-zA-Z0-9 ]/g, "").trim() // Clean title
        : "Book Title";

      // Normalize TOC mappings by decoding the keys
      const chapterTitles: Record<string, string> = {};
      epub.toc.forEach((entry) => {
        if (!entry.href || !entry.title) return;

        const decodedHref: string = decodeURIComponent(entry.href); // Fix encoded spaces (%20) and other characters
        chapterTitles[decodedHref] = entry.title;
      });

      let currentSize: number = 0;
      let currentPart: Chapter[] = [];
      let partNumber: number = 1;

      const savePart = async (): Promise<void> => {
        if (currentPart.length === 0) return;

        const outputFileName: string = path.join(
          outputDir,
          `${bookTitle} - Part ${partNumber}.epub`
        );
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
          if (!ch.id || !ch.href) {
            console.warn("Skipping invalid chapter:", ch);
            continue;
          }

          // Skip images or non-text files
          if (
            ch.href.endsWith(".jpg") ||
            ch.href.endsWith(".png") ||
            ch.href.endsWith(".gif")
          ) {
            console.warn(`Skipping image: ${ch.href}`);
            continue;
          }

          const content: string = await getChapterContent(epub, ch.id);

          // Normalize the href for lookup
          const normalizedHref: string = decodeURIComponent(ch.href);

          // Get the actual title from the TOC mapping, fallback to default
          const title: string =
            chapterTitles[normalizedHref] || ch.title || "Untitled";

          const chapter: Chapter = { title, content };
          const chapterSize: number = Buffer.byteLength(
            chapter.content,
            "utf-8"
          );

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
