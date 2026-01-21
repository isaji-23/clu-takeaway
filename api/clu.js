export default async function handler(req, res) {
    // CORS (para poder llamarlo desde tu frontend)
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") return res.status(204).end();
    if (req.method !== "POST")
        return res.status(405).json({ error: "Use POST" });

    try {
        const { text } = req.body || {};
        if (!text || typeof text !== "string") {
            return res.status(400).json({ error: "Missing 'text' in body" });
        }

        const endpoint = process.env.AZURE_CLU_ENDPOINT;
        const key = process.env.AZURE_CLU_KEY;
        const projectName = process.env.AZURE_CLU_PROJECT_NAME;
        const deploymentName = process.env.AZURE_CLU_DEPLOYMENT_NAME;
        const apiVersion = process.env.AZURE_CLU_API_VERSION || "2024-11-01";

        if (!endpoint || !key || !projectName || !deploymentName) {
            return res
                .status(500)
                .json({ error: "Server env vars not configured" });
        }

        const url = `${endpoint}/language/:analyze-conversations?api-version=${encodeURIComponent(apiVersion)}`;

        const payload = {
            kind: "Conversation",
            analysisInput: {
                conversationItem: {
                    id: "1",
                    participantId: "User",
                    modality: "text",
                    language: "en-us",
                    text,
                },
            },
            parameters: {
                projectName,
                deploymentName,
                stringIndexType: "Utf16CodeUnit",
            },
        };

        const cluRes = await fetch(url, {
            method: "POST",
            headers: {
                "Ocp-Apim-Subscription-Key": key,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });

        const data = await cluRes.json().catch(() => null);

        if (!cluRes.ok) {
            return res.status(cluRes.status).json({
                error: "Azure CLU error",
                status: cluRes.status,
                details: data,
            });
        }

        // Devuelve el JSON tal cual para que tu frontend siga igual
        return res.status(200).json(data);
    } catch (err) {
        return res
            .status(500)
            .json({ error: "Server exception", message: err?.message });
    }
}
