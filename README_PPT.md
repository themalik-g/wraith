# PowerPoint AI Generation (.ppt)

WRAITH includes an AI-powered PowerPoint generation module driven by Gemini API (`gemini-2.5-flash` / `gemini-1.5-flash`) and rendered directly in memory using `pptxgenjs`.

## Setup
Ensure `GEMINI_API_KEY` is set in your environment or `.env` / `keys.env`:
```bash
GEMINI_API_KEY="your-gemini-api-key"
```

## Command Syntax
```text
.ppt <topic>;<subtopics>;<theme keywords>;<number of slides>
```
- Only `<topic>` is required. All other parameters are optional separated by semicolons (`;`).

## Examples

### 1. Minimal Topic
```text
.ppt atomic energy
```
Generates a default presentation overview on atomic energy.

### 2. Specific Subtopics, Theme & Slide Count
```text
.ppt female reproductive system;ovaries, uterus, hormones;warm medical green;10
```
Generates a 10-slide medical presentation with custom color theme matching green tones and covering specified subtopics.

### 3. Topic, Theme & Custom Slide Count
```text
.ppt cloud computing;;dark blue;8
```
Generates an 8-slide presentation on cloud computing with a dark blue aesthetic theme.

### 4. Technical Architecture
```text
.ppt microservices architecture;service mesh, event-driven, api gateway;tech neon dark;6
```
Generates a 6-slide dark neon styled technical deck focusing on key microservice design patterns.

## Features & System Rules
- **Non-overridable Gemini System Prompt**: Always returns structured JSON (`responseSchema`) adhering strictly to presentation rules.
- **In-Memory Rendering**: `.pptx` presentations are built entirely in Node memory (`Buffer`) with no temporary files written to disk.
- **Attribution**: Every presentation includes clean headers/footers and `Provided by 𝗪𝗥𝗔𝗜𝗧🇭` attribution.
