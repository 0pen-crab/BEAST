# BEAST Project Instructions

## Development Workflow (TDD — mandatory)

Every feature and bugfix MUST follow this process:

1. **Write/update unit tests FIRST** — colocated next to source (`foo.ts` → `foo.test.ts`)
2. **Write the implementation code**
3. **Run unit tests** — all must pass before proceeding
   ```
   ./test.sh
   ```
4. **Run E2E tests** — all must pass
   ```
   cd e2e && npx playwright test
   ```
5. **Verify in browser** — open the app at localhost:8000 in Chrome, log in with admin/admin1, and manually confirm the feature works as expected
6. **Feature is done only when ALL tests pass AND browser verification confirms it works**

Do NOT skip steps. Do NOT write implementation before tests. If you modify existing code, update its colocated test file too. Do NOT claim a feature is complete without browser verification.

## Smoke Test (mandatory after major changes)

Each major change of design or backend MUST end with the smoke test performed in browser (Chrome). See [TESTS.md](./TESTS.md) for the full procedure.

Quick run:
```
cd e2e && npx playwright test smoke.spec.ts
```

The smoke test covers: admin account creation → workspace creation → source import → tool configuration → scan execution → result verification.

## Main design patterns


### KISS (KEEP IT SIMPLE, STUPID)
If you are doing some sort of a hack (use regex, or helper functions, or transformers) - ask yourself, wouldnt it be better to refactor the code to work properly and keep the codebase clean and obvious. Avoid using magic practices or obscure tricks.
### Avoid legacy
If you are rewriting the code to a new logic, ask whether you need to keep fallbacks for old logic, or not. Sometimes there is no need to support legacy code since it could be written by yourself a couple of hours ago.

### Proper logging and monitoring
At any cost avoid silent errors and fallbacks. Every error should scream so i can detect it on early stages, react to it and solve a problem.

### Tests. Everything should be covered by tests
Each time the error occures - ask yourself, what type of test could've prevented us from this? Write corresponding tests, and add a task to backlog to cover similar areas with tests like this.

### Write a clean frontend code.
While working with frontend - use a reusable classes instead of specifying styles with classes like mb-4 border-th-5, or inline styles. Make a reusable components and elements which could be added to a different pages, instead of duplicating code.

### DRY
Do NOT repeat yourself. Most of the time there is no need to write a new components when creating a new page. It leads us to unsupportable legacy app even if the project is relatively new. While rewriting existing components, make sure to run all related tests, especially integration tests to understand whether youve broke other places where this component is used or not


## Communication rules

### Stop implementing immediatelly
Whenever you see a question mark at the end of my prompt - DO NOT WRITE ANY CODE. It's a question, and you should ANSWER it, instead of changing the code.

### Commiting
Do NOT touch the git. I will commit chages myself.

### Use chrome to debug
Every time i paste you a link like "check this error", the best way to open it - using chrome extension in browser. If it fails - ask me to connect extension. If it's clearly something which requires curl request - then use curl.


## HTML, CSS, Frontend and UI/UX

NO FUCKING INLINE STYLES OR TAILWIND MODIFICATORS SUCH AS text-sm, mb-4 or other shit.
The main reference for any UI element is this toolkit - http://localhost:8000/toolkit.html , refer to it if you need some elements. Use existing classes. If there is no element you are loking for, consider adding it to toolkit first, and then use in the actual page. Make reusable components, classes, modificators, I DARE YOU.