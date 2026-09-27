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
      model = "gemini-3.8-flash",
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
    // generate ho, turant client tak pahunch jaye — poora jawab complete hone
    // tak wait nahi karna padega. Isse response bahut tez mehsoos hota hai.
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cleanModel)}:streamGenerateContent?alt=sse`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [
              {
                text: systemInstruction
              }
            ]
          },
          contents,
          generationConfig: {
            // Bahut lambe jawab response ko dheema karte hain — isse zyada
            // lamba javab nahi banega, tez khatam hoga.
            maxOutputTokens: 1024
          }
        })
      }
    );

    if (!geminiResponse.ok) {
      let errData = {};
      try {
        errData = await geminiResponse.json();
      } catch (e) {}
      console.error("Gemini error:", errData);
      return res.status(geminiResponse.status).json({
        error: errData?.error?.message || "Gemini API error"
      });
    }

    // Ab plain text stream ke roop mein client ko chunk-by-chunk bhejo.
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Model-Used": cleanModel
    });

    const reader = geminiResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let sentAnything = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop(); // aakhri, abhi-tak-incomplete chunk agli baar ke liye rakho
      for (const evt of events) {
        const line = evt.replace(/^data:\s*/, "").trim();
        if (!line || line === "[DONE]") continue;
        try {
          const json = JSON.parse(line);
          const textPiece =
            json?.candidates?.[0]?.content?.parts
              ?.map(p => p.text || "")
              .join("") || "";
          if (textPiece) {
            res.write(textPiece);
            sentAnything = true;
          }
        } catch (e) {
          // partial/invalid JSON chunk — ignore, agla chunk milne par sahi ho jayega
        }
      }
    }

    if (!sentAnything) {
      res.write("AI ne koi response nahi diya.");
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
