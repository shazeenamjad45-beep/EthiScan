export default async function handler(req, res) {
  // CORS Headers for Chrome Extension
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { text, domain = 'Web Document', preset = 'standard' } = req.body || {};
    
    if (!text || text.length < 10) {
      return res.status(400).json({ error: 'Missing or empty policy text.' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Server environment variable GEMINI_API_KEY is not configured.' });
    }

    const promptText = `
You are an expert privacy legal auditor evaluating terms of service / privacy policies for ${domain}.
Active Priority Profile: ${preset}.

Text to evaluate:
"""
${text.slice(0, 25000)}
"""

Evaluate legal risks across 4 categories:
1. Media & Identity Safety (non-consensual media rights, AI model training on user photos, facial recognition).
2. Data Sale & Commercialization (selling data to ad networks, location tracking).
3. Financial Traps (hidden auto-renewals, non-refundable charges, forced binding arbitration).
4. User Rights & Erasure Friction (account deletion friction, GDPR/CCPA right to be forgotten).

Return STRICT JSON only matching this schema:
{
  "trust_grade": "A" | "B" | "C" | "D" | "F",
  "safety_score": 0-100 number,
  "summary": {
    "trust_grade": "A" | "B" | "C" | "D" | "F",
    "safety_score": 0-100 number,
    "description": "3-4 lines plain English summary of terms for a non-legal reader"
  },
  "pillars": {
    "media": count,
    "data": count,
    "financial": count,
    "rights": count
  },
  "risk_clauses": [
    {
      "severity": "HIGH" | "MEDIUM",
      "category": "Media & Identity" | "Data Commercialization" | "Financial Traps" | "User Rights",
      "verbatim_quote": "exact character-for-character phrase copied from source text",
      "explanation": "Plain English explanation of why this clause is risky",
      "violated_frameworks": ["GDPR Art. 6", "CCPA Sec. 1798", "PECA", "PIPEDA"]
    }
  ]
}
`;

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const geminiRes = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptText }] }],
        generationConfig: { responseMimeType: "application/json" }
      })
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      return res.status(geminiRes.status).json({ error: `Gemini API HTTP Error: ${errText}` });
    }

    const data = await geminiRes.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!rawText) {
      return res.status(500).json({ error: 'Empty text returned from Gemini API' });
    }

    const parsedResult = JSON.parse(rawText);
    return res.status(200).json(parsedResult);

  } catch (err) {
    console.error('[Vercel Serverless Proxy Error]:', err);
    return res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
}
