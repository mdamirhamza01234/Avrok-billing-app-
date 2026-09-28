export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: "GEMINI_API_KEY Vercel mein configured nahi hai."
      });
    }
    const {
      message,
      messages = [],
      model = "gemini-3.5-flash",
      image
    } = req.body || {};
    if (!message && !image) {
      return res.status(400).json({
        error: "Message ya photo required hai."
      });
    }
    const systemInstruction = `
You are AVROK AI Assistant inside the AVROK ACS application.
You have advanced professional knowledge of:
AC SERVICES:
- Split AC
- Window AC
- Inverter AC
- Non-inverter AC
- Compressor
- Condenser
- Evaporator
- Expansion valve
- Capillary
- Refrigerant
- Gas charging
- Gas leakage
- Vacuuming
- Pressure
- Cooling problems
- PCB
- Sensors
- Fan motor
- Capacitor
- Contactor
- Thermostat
- Drain blockage
- Water leakage
- Ice formation
- High/low pressure
- AC installation
- AC servicing
- AC maintenance
- Troubleshooting
ELECTRICAL / ELECTRICIAN:
- Phase
- Neutral
- Earth
- Voltage
- Current
- Resistance
- Power
- Watt
- MCB
- RCCB
- RCBO
- ELCB
- Contactor
- Relay
- Capacitor
- Motor
- Single phase
- Three phase
- Earthing
- Short circuit
- Overload
- House wiring
- AC wiring
- Electrical fault finding
AVROK ACS APP:
- Bill Generator
- Quotation Generator
- Customer information
- Service information
- Billing
- Quotations
- App features and workflows
When the user sends a photo of an AC unit, PCB, wiring, switchboard, or any
electrical/AC component, carefully look at it and:
- Describe what you see relevant to the problem.
- Identify the likely fault or issue.
- Explain, step by step, how to fix it or how to wire it correctly.
- Always prioritize safety, especially for electrical connections.
Answer in the same language as the user.
If the user uses Hindi/Hinglish, answer in simple Hindi/Hinglish.
Give practical and detailed technical explanations.
Do not invent actual customer, bill, stock,
quotation or app data that has not been provided.
For electrical work, always prioritize safety.
Never instruct the user to work on live electrical wiring.
`;
    const contents = Array.isArray(messages)
      ? messages.slice(-30).map(item => ({
          role:
            item.role === "assistant"
              ? "model"
              : "user",
          parts: [
            {
              text: String(
                item.content ||
                item.text ||
                ""
              )
            }
          ]
        }))
      : [];

    // Current turn: text (agar hai) + photo (agar attach ki gayi hai), dono
    // ek hi user turn ke parts ke andar Gemini ko bhejo (multimodal input).
    const currentParts = [];
    if (message) {
      currentParts.push({ text: message });
    }
    if (image && image.data) {
      currentParts.push({
        inlineData: {
          mimeType: image.mimeType || "image/jpeg",
          data: image.data
        }
      });
    }
    if (currentParts.length === 0) {
      currentParts.push({ text: "" });
    }
    contents.push({
      role: "user",
      parts: currentParts
    });

    // Prevent invalid model path manipulation
    const cleanModel = String(model)
      .replace(/^models\//, "")
      .trim();

    // Gemini ka streamGenerateContent (SSE) use karo taaki jawab jaise-jaise
    // generate ho, turant client tak pahunch jaye.
    // Agar ek model overloaded (503/429) ho, toh apne aap agla model try karo.
    const modelsToTry = [cleanModel, "gemini-3.1-flash-lite", "gemini-3.8-flash"]
      .filter((m, i, arr) => arr.indexOf(m) === i);

    const requestBody = JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemInstruction }]
      },
      contents,
      generationConfig: {
        // Gemini 3 models ki "thinking" tokens bhi isi budget mein katti hain.
        // Thinking low rakho aur budget badhao taaki jawab ke liye jagah bache.
        maxOutputTokens: 2048,
        thinkingConfig: { thinkingLevel: "LOW" }
      }
    });

    let geminiResponse = null;
    let usedModel = cleanModel;
    let lastErr = { status: 500, message: "Gemini API error" };

    for (const m of modelsToTry) {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:streamGenerateContent?alt=sse`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey
          },
          body: requestBody
        }
      );
      if (r.ok) {
        geminiResponse = r;
        usedModel = m;
        break;
      }
      let errData = {};
      try {
        errData = await r.json();
      } catch (e) {}
      console.error("Gemini error (" + m + "):", errData);
      lastErr = {
        status: r.status,
        message: errData?.error?.message || "Gemini API error"
      };
      // Sirf overload / rate-limit / server error par doosra model try karo
      if (![429, 500, 503, 504].includes(r.status)) break;
    }

    if (!geminiResponse) {
      return res.status(lastErr.status).json({ error: lastErr.message });
    }

    // Ab plain text stream ke roop mein client ko chunk-by-chunk bhejo.
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Model-Used": usedModel
    });

    const reader = geminiResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let sentAnything = false;
    let lastInfo = "";

    // Ek SSE event process karo: "data: {...}" lines se JSON nikal kar
    // uska text client ko bhejo.
    const handleEvent = (evt) => {
      const dataLines = evt
        .split("\n")
        .filter(l => l.startsWith("data:"))
        .map(l => l.replace(/^data:\s?/, ""));
      const payload = dataLines.join("\n").trim();
      if (!payload || payload === "[DONE]") return;
      try {
        const json = JSON.parse(payload);
        const cand = json?.candidates?.[0];
        const textPiece =
          cand?.content?.parts
            ?.filter(p => !p.thought)
            .map(p => p.text || "")
            .join("") || "";
        if (textPiece) {
          res.write(textPiece);
          sentAnything = true;
        }
        if (cand?.finishReason && cand.finishReason !== "STOP") {
          lastInfo = "finishReason: " + cand.finishReason;
        }
        if (json?.promptFeedback?.blockReason) {
          lastInfo = "blocked: " + json.promptFeedback.blockReason;
        }
      } catch (e) {
        // incomplete/invalid JSON — ignore
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      // Google SSE events "\r\n\r\n" se alag hote hain — pehle sab "\n" mein badlo.
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      const events = buffer.split("\n\n");
      buffer = events.pop(); // aakhri incomplete event agli baar ke liye
      for (const evt of events) handleEvent(evt);
    }
    // Stream khatam hone par bacha hua buffer bhi process karo
    buffer += decoder.decode();
    buffer = buffer.replace(/\r\n/g, "\n");
    if (buffer.trim()) handleEvent(buffer);

    if (!sentAnything) {
      res.write(
        "AI ne koi response nahi diya." + (lastInfo ? " (" + lastInfo + ")" : "")
      );
    }
    return res.end();
  } catch (error) {
    console.error("Server error:", error);
    if (!res.headersSent) {
      return res.status(500).json({
        error: "AI server error."
      });
    }
    return res.end();
  }
}
