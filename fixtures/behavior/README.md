# Cross-host behavior fixtures

These scenarios define observable Palot behavior without coupling the fixture
to Electron IPC or Burl services. Use a disposable OpenCode session and a
temporary project for runtime capture.

1. Launch the application and choose the fixture project directory.
2. Start or connect to OpenCode and create a session.
3. Enter the multiline prompt from `chat-smoke.json`, submit it, and verify a
   streamed response is visible before completion.
4. Verify Markdown paragraphs, emphasis, list, inline code, fenced code, and a
   basic tool-call card.
5. Cancel an in-flight prompt, retry it, and verify no duplicate/reordered
   transcript parts.
6. Select transcript text; copy and paste it into the composer; enter composed
   IME text; navigate and scroll using the keyboard.
7. Close and reopen the application and verify the selected project, session,
   and transcript are restored.
8. Verify the transcript and composer are exposed to the platform accessibility
   tree.

Record host, application revision, OpenCode version, scenario result, and
artifact paths. Do not commit credentials, project content, or raw private
conversation transcripts.
