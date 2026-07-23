import { generateKeywordsFromText } from "../../../../lib/keyword-generator.js";

import { extractTextFromOcrInput } from "../../../../lib/ocr-extract.js";

import { extractKeywordFromOcr } from "../../../../lib/snapshot-ai.js";



export async function POST(request) {

  try {

    const body = await request.json();

    const screenshot = typeof body?.screenshot === "string" ? body.screenshot : "";

    const ocrTextInput = typeof body?.ocrText === "string" ? body.ocrText : "";

    const title = typeof body?.title === "string" ? body.title : "";

    const url = typeof body?.url === "string" ? body.url : "";



    if (!screenshot && !ocrTextInput.trim()) {

      return Response.json({ error: "screenshot or ocrText required" }, { status: 400 });

    }



    const { text: ocrText, source: ocrSource } = await extractTextFromOcrInput({

      ocrText: ocrTextInput,

      screenshot

    });



    const heuristicKeyword = generateKeywordsFromText(ocrText, { max: 1 })[0] || "";

    const { keyword, source } = await extractKeywordFromOcr({

      ocrText,

      title,

      url,

      heuristicKeyword

    });



    return Response.json({

      ocrText,

      ocrSource,

      keyword,

      memorySource: source

    });

  } catch (err) {

    console.error("[snapshot/process]", err);

    return Response.json({ error: "snapshot process failed" }, { status: 500 });

  }

}

