const express = require('express');
const router = express.Router();
const axios = require('axios');

router.post('/api/chat', async (req, res) => {
  const { messages } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Invalid request. Messages array is required.' });
  }

  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey || groqApiKey.includes('YOUR_GROQ_API_KEY')) {
    console.error('Groq API Key is missing or misconfigured in .env');
    return res.status(500).json({ 
      response: "Hello! I'm the PW Office assistant. My AI service is currently not configured with an API key. Please set the GROQ_API_KEY in the environment." 
    });
  }

  try {
    const isEditor = req.body.context === 'editor';
    const systemPromptContent = isEditor
      ? "You are a helpful assistant for PW Office, specifically helping users while they edit documents and spreadsheets. You can explain spreadsheet formulas (like VLOOKUP, INDEX/MATCH, SUMIF, pivot tables), suggest formula syntax, explain document formatting features, and answer general how-to questions about using the editor. Be concise, use examples, and format formula suggestions in a monospace/code style when relevant."
      : "You are a helpful assistant for PW Office, a document/spreadsheet/presentation collaboration platform. Help users with questions about using the platform, features, and general support. Be concise and friendly.";

    const systemPrompt = {
      role: 'system',
      content: systemPromptContent
    };

    // Combine system prompt with user messages
    const apiMessages = [systemPrompt, ...messages];

    console.log('Sending message request to Groq API...');
    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.3-70b-versatile',
        messages: apiMessages,
        temperature: 0.7,
        max_tokens: 500
      },
      {
        headers: {
          'Authorization': `Bearer ${groqApiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000 // 10s timeout
      }
    );

    const reply = response.data.choices[0].message.content;
    res.json({ response: reply });
  } catch (err) {
    console.error('Error communicating with Groq API:', err.message);
    if (err.response) {
      console.error('Groq API response error data:', err.response.data);
    }
    res.status(500).json({ 
      error: 'Failed to get response from assistant.',
      response: 'Sorry, I encountered an error while communicating with my AI backend. Please try again in a moment.'
    });
  }
});

module.exports = router;
