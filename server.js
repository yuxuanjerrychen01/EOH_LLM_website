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

// CHANGED: new JSON file to store all decoration history
const DECORATIONS_FILE = path.join(__dirname, 'decorations_history.json');

// CHANGED: default decoration HTML is now the first fallback entry in JSON
const DEFAULT_DECORATION_HTML = `
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
`.trim();

// Initialize survey data file if it doesn't exist
if (!fs.existsSync(DATA_FILE)) {
    const initialData = { q1: {}, q2: {} };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2));
}

// CHANGED: helper to build the default first decoration entry
function createDefaultDecorationEntry() {
    return {
        id: 1,
        prompt: '__default__',
        html: DEFAULT_DECORATION_HTML,
        createdAt: new Date().toISOString(),
        isDefault: true
    };
}

// CHANGED: ensure decorations JSON exists and always starts with default
function ensureDecorationsFile() {
    try {
        if (!fs.existsSync(DECORATIONS_FILE)) {
            const initialData = {
                decorations: [createDefaultDecorationEntry()]
            };
            fs.writeFileSync(DECORATIONS_FILE, JSON.stringify(initialData, null, 2));
            return;
        }

        const raw = fs.readFileSync(DECORATIONS_FILE, 'utf8');
        const parsed = JSON.parse(raw);

        const hasValidArray = parsed && Array.isArray(parsed.decorations);

        if (!hasValidArray || parsed.decorations.length === 0) {
            throw new Error('Invalid decorations file structure');
        }

        const first = parsed.decorations[0];
        const firstIsUsable =
            first &&
            typeof first.html === 'string' &&
            first.html.trim().length > 0;

        if (!firstIsUsable) {
            parsed.decorations.unshift(createDefaultDecorationEntry());
            fs.writeFileSync(DECORATIONS_FILE, JSON.stringify(parsed, null, 2));
        }
    } catch (err) {
        console.error('Error ensuring decorations file. Rebuilding with default.', err);
        const resetData = {
            decorations: [createDefaultDecorationEntry()]
        };
        fs.writeFileSync(DECORATIONS_FILE, JSON.stringify(resetData, null, 2));
    }
}

// CHANGED: read all decoration history, with hard fallback to default
function readDecorationsData() {
    try {
        ensureDecorationsFile();

        const raw = fs.readFileSync(DECORATIONS_FILE, 'utf8');
        const parsed = JSON.parse(raw);

        if (!parsed || !Array.isArray(parsed.decorations) || parsed.decorations.length === 0) {
            throw new Error('Decorations data invalid');
        }

        return parsed;
    } catch (err) {
        console.error('Error reading decorations data. Falling back to default.', err);

        const fallback = {
            decorations: [createDefaultDecorationEntry()]
        };

        try {
            fs.writeFileSync(DECORATIONS_FILE, JSON.stringify(fallback, null, 2));
        } catch (writeErr) {
            console.error('Failed to rewrite fallback decorations file.', writeErr);
        }

        return fallback;
    }
}

// CHANGED: returns the first/default entry from JSON
function getDefaultDecorationEntry() {
    const data = readDecorationsData();
    return data.decorations[0] || createDefaultDecorationEntry();
}

// CHANGED: returns the most recent valid decoration, else the default first entry
function getMostRecentDecorationEntry() {
    const data = readDecorationsData();

    for (let i = data.decorations.length - 1; i >= 0; i--) {
        const item = data.decorations[i];
        if (item && typeof item.html === 'string' && item.html.trim()) {
            return item;
        }
    }

    return getDefaultDecorationEntry();
}

// CHANGED: save every generated decoration to history
function appendDecorationToHistory(prompt, html) {
    const data = readDecorationsData();
    const decorations = data.decorations || [];

    const lastId = decorations.length > 0
        ? Math.max(...decorations.map(item => Number(item.id) || 0))
        : 0;

    const entry = {
        id: lastId + 1,
        prompt: String(prompt || '').trim(),
        html: String(html || '').trim(),
        createdAt: new Date().toISOString(),
        isDefault: false
    };

    decorations.push(entry);

    const updatedData = { decorations };
    fs.writeFileSync(DECORATIONS_FILE, JSON.stringify(updatedData, null, 2));

    return entry;
}

// CHANGED: initialize decorations JSON at startup
ensureDecorationsFile();

function requireAuth(req, res, next) {
    if (req.session && req.session.authed) return next();
    return res.redirect('/prompt');
}

app.get('/prompt', (req, res) => {
    res.render('prompt', { authed: !!(req.session && req.session.authed) });
});

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

    html = html.replace(/^```(?:html)?\s*/i, "");
    html = html.replace(/\s*```$/i, "");
    html = html.replace(/^html\s*/i, "");

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
        let cleanedHTML = cleanHTMLResponse(rawHTML);

        // CHANGED: if generation fails/comes back empty, fall back to default JSON first entry
        if (!cleanedHTML) {
            cleanedHTML = getDefaultDecorationEntry().html;
        }

        // CHANGED: save every successful/fallback decoration into full history JSON
        const savedEntry = appendDecorationToHistory(req.body.prompt, cleanedHTML);

        res.json({
            success: true,
            message: "Page updated!",
            decorationId: savedEntry.id
        });
    } catch (err) {
        console.error(err);

        // CHANGED: on AI error, still fall back to the default JSON entry and save that fallback
        try {
            const fallbackEntry = appendDecorationToHistory(
                '__ai_error_fallback__',
                getDefaultDecorationEntry().html
            );

            return res.json({
                success: true,
                message: "AI error occurred. Fell back to default decoration.",
                decorationId: fallbackEntry.id,
                fallback: true
            });
        } catch (fallbackErr) {
            console.error('Fallback save failed.', fallbackErr);
            return res.status(500).json({ success: false, message: "AI Error" });
        }
    }
});

// CHANGED: always read newest valid decoration from JSON instead of memory
app.get('/results', (req, res) => {
    const latestDecoration = getMostRecentDecorationEntry();
    res.render('results', { decoration: latestDecoration.html });
});

app.post('/submit-survey', (req, res) => {
    const { q1, q2 } = req.body;
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));

    if (q1 && q2) {
        data.q1[q1] = (data.q1[q1] || 0) + 1;
        data.q2[q2] = (data.q2[q2] || 0) + 1;
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    }

    res.json(data);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on ${PORT}`));