const express = require('express');
const { OpenAI } = require('openai');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const session = require('express-session');

const app = express();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(session({
    secret: process.env.SESSION_SECRET || 'localsecret',
    resave: false,
    saveUninitialized: false
}));

app.set('view engine', 'ejs');

const DATA_FILE = path.join(__dirname, 'survey_results.json');

// Initialize json data file if it doesn't exist
if (!fs.existsSync(DATA_FILE)) {
    const initialData = { q1: {}, q2: {} };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initialData));
}

let currentDecoratedHTML = `
  <div style="
    background: #222;
    height: 100svh;
    width: 100vw;
    margin: 0;
    overflow: hidden;
    position: relative;
    color: white;
    font-family: sans-serif;
  ">
    <h1 style="
      position: absolute;
      left: 50%;
      bottom: 20%;
      transform: translateX(-50%);
      margin: 0;
    ">
      Decorate this webpage :)
    </h1>
  </div>
`;

function requireAuth(req, res, next) {
    if (req.session && req.session.authed) return next();
    return res.redirect('/prompt');
}

app.get('/prompt', (req, res) => {
    res.render('prompt', { authed: !!(req.session && req.session.authed) });
});
// app.get('/prompt', (req, res) => res.render('prompt'));

app.post('/login', (req, res) => {
    const password = String(req.body.password || '');
    const expected = String(process.env.EMPLOYEE_PASS || 'eohpassword1');

    if (password && expected && password === expected) {
        req.session.authed = true;
        return res.json({ success: true });
    }

    return res.status(401).json({ success: false });
});


function cleanHTMLResponse(raw) {
    if (!raw) return "";
    let html = raw.trim();
    // Remove fenced code block opener like ```html or ```
    html = html.replace(/^```(?:html)?\s*/i, "");
    // Remove fenced code block closer
    html = html.replace(/\s*```$/i, "");
    // Remove stray leading "html"
    html = html.replace(/^html\s*/i, "");
    // Remove wrapping quotes/backticks if the whole response is wrapped
    if (
        (html.startsWith('"') && html.endsWith('"')) ||
        (html.startsWith("'") && html.endsWith("'")) ||
        (html.startsWith("`") && html.endsWith("`"))
    ) {
        html = html.slice(1, -1).trim();
    }
    return html.trim();
}



app.post('/generate', requireAuth, async (req, res) => {
    try {
        const response = await openai.chat.completions.create({
            model: "gpt-5.2",
            messages: [
                {
                role: "system",
                content: `
You generate ONLY a self-contained HTML fragment with inline CSS.
Do not output markdown, code fences, explanations, or backticks.

Goal:
Create a decorative background for a webpage.

Requirements:
- Output valid HTML only.
- Do not use external assets, libraries, or external/internal URLs.
- Do not include forms, buttons, inputs, links, menus, or interactive UI.
- Do not include large text blocks.

Output rules:
- Return ONLY the HTML fragment.
- No explanations.
- No surrounding template like <!DOCTYPE html>, <html>, <head>, or <body>.
                `.trim()
                },
                {
                role: "user",
                content: `
Decorate this html:
<div style="background:#222;height:100svh;width:100vw;margin:0;overflow:hidden;position:relative;color:white;font-family:sans-serif;">
</div>

Use this theme: ${req.body.prompt}

Create depth using 2 to 5 visual layers.
 - Use variation in scale, position, opacity, and shape. 
 - Prefer asymmetry or balanced focal areas over flat uniform layouts. 
 - Avoid a single plain gradient unless the user explicitly asks for minimalism. 
 - Keep the center or a major content area reasonably usable behind foreground content. 
 - Make it as fun and crazy as possible but keep it self contained so it just runs as an html. Use many emojis but no text!!  
                `.trim()
                }
            ]
            });
        const rawHTML = response.choices[0].message.content || "";
        currentDecoratedHTML = cleanHTMLResponse(rawHTML);
        if (!currentDecoratedHTML) {
            currentDecoratedHTML = `
                <div style="width:100vw;height:100svh;margin:0;overflow:hidden;position:relative;
                            background:linear-gradient(135deg,#1f2937,#111827);"></div>
            `;
        }
        res.json({ success: true, message: "Page updated!" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "AI Error" });
    }
});


app.get('/results', (req, res) => {
    res.render('results', { decoration: currentDecoratedHTML });
});


app.post('/submit-survey', (req, res) => {
    const { q1, q2 } = req.body;
    const data = JSON.parse(fs.readFileSync(DATA_FILE));
    // Only increment if data was actually provided (not a skip)
    if (q1 && q2) {
        data.q1[q1] = (data.q1[q1] || 0) + 1;
        data.q2[q2] = (data.q2[q2] || 0) + 1;
        fs.writeFileSync(DATA_FILE, JSON.stringify(data));
    }

    res.json(data); 
});

// app.listen(3000, () => console.log('Server: http://localhost:3000/prompt'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on ${PORT}`));