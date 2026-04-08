const PPIO_URL = "https://api.ppio.com/openai/v1/chat/completions";
const MODEL = "minimax/minimax-m2.7";

const translationCache = new Map<string, string>();

export async function translateTitles(
  titles: string[],
  apiKey: string
): Promise<string[]> {
  const results: string[] = new Array(titles.length);
  const uncached: { i: number; title: string }[] = [];

  for (let i = 0; i < titles.length; i++) {
    const cached = translationCache.get(titles[i]);
    if (cached) {
      results[i] = cached;
    } else {
      uncached.push({ i, title: titles[i] });
    }
  }

  if (uncached.length === 0) return results;

  const numbered = uncached.map((t, j) => `${j + 1}. ${t.title}`).join("\n");

  try {
    const res = await fetch(PPIO_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "system",
            content:
              "Translate these English headlines to concise Simplified Chinese. Return ONLY a JSON array of strings in the same order. No markdown.",
          },
          {
            role: "user",
            content: `${numbered}\n\nReturn: ["中文1","中文2",...]`,
          },
        ],
        temperature: 0.1,
      }),
    });

    if (!res.ok) {
      console.log("[Translate] API error:", res.status, await res.text().then(t => t.slice(0, 200)));
      for (const item of uncached) results[item.i] = item.title;
      return results;
    }

    const data = await res.json();
    let text: string = data.choices?.[0]?.message?.content?.trim() || "";
    console.log("[Translate] Raw response:", text.slice(0, 300));

    if (text.startsWith("```")) {
      text = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    // Handle case where model returns reasoning + JSON
    const jsonStart = text.indexOf("[");
    const jsonEnd = text.lastIndexOf("]");
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      text = text.slice(jsonStart, jsonEnd + 1);
    }

    const translated: string[] = JSON.parse(text);

    for (let j = 0; j < uncached.length; j++) {
      const item = uncached[j];
      const zh = translated[j];
      if (zh && typeof zh === "string") {
        results[item.i] = zh;
        translationCache.set(item.title, zh);
      } else {
        results[item.i] = item.title;
      }
    }
  } catch (err) {
    console.log("[Translate] Error:", err instanceof Error ? err.message : String(err));
    for (const item of uncached) results[item.i] = item.title;
  }

  return results;
}
