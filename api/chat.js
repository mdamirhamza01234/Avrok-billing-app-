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
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cleanModel)}:generateContent`,
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
          contents
        })
      }
    );
    const data = await response.json();
    if (!response.ok) {
      console.error("Gemini error:", data);
      return res.status(response.status).json({
        error:
          data?.error?.message ||
          "Gemini API error"
      });
    }
    const reply =
      data?.candidates?.[0]?.content?.parts
        ?.map(part => part.text || "")
        .join("") ||
      "AI ne koi response nahi diya.";
    return res.status(200).json({
      reply,
      model: cleanModel
    });
  } catch (error) {
    console.error("Server error:", error);
    return res.status(500).json({
      error: "AI server error."
    });
  }
}
