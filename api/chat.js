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
      model = "gemini-3.8-flash"
    } = req.body || {};

    if (!message) {
      return res.status(400).json({
        error: "Message required hai."
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

    contents.push({
      role: "user",
      parts: [
        {
          text: message
        }
      ]
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
