import { watch } from "node:fs";
import { parseArgs } from "node:util";
import { collectTests } from "../src/test/commentTestCollector";
import { intoRecords } from "../src/test/commentTestUtils";

const watchDir = `${import.meta.dir}/../src`;

const { values } = parseArgs({
  args: Bun.argv,
  options: {
    watch: {
      type: "boolean",
      default: false,
    },
  },
  strict: true,
  allowPositionals: true,
});

async function generateJson() {
  try {
    const records = intoRecords(await collectTests());
    await Bun.write("./dist/tests/commentTests.json", JSON.stringify(records));
  } catch (error) {
    console.log(error);
  }
}

await generateJson();
if (values.watch) {
  const watcher = watch(
    watchDir,
    { recursive: true },
    async (event, filename) => {
      console.log(`${event}: ${filename}, regenerating commentTests.json`);
      await generateJson();
    },
  );

  process.on("SIGINT", () => {
    // close watcher when Ctrl-C is pressed
    console.log("Closing watcher...");
    watcher.close();

    process.exit(0);
  });
}
