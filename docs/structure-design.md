Bạn review kiến trúc `agent-orchestra` dựa trên 10 nguyên tắc thiết kế dưới đây, xem có cái gì có thể apply và áp dụng dược vào dự án của mình không nhé.

1) Tách rõ 4 lớp: entrypoint / runtime / tools / policy

Một điểm mạnh của các harness nghiêm túc là không trộn tất cả vào một nồi.

nên tách rõ:

• entrypoint: nhận task / command / event
• runtime: turn loop, state machine, orchestration
• tools: file/shell/web/app integrations
• policy: quyền, an toàn, trust, execution rules

Lợi

• dễ debug
• dễ thay model
• dễ thay tool backend
• tránh spaghetti logic

───

2) Session/transcript là first-class citizen

Đừng coi history chỉ là chat log.
Nó phải là một phần của runtime.

agent-orchestra nên có:

• session object rõ ràng
• transcript store
• replay/load
• flush/checkpoint
• thread/run boundaries

Lợi

• multi-agent ổn định hơn
• resume tốt hơn
• debug “vì sao agent làm vậy” dễ hơn

───

3) Tool execution phải có registry chuẩn

Không chỉ “gọi lệnh nào cũng được”.

Nên có:

• tool registry
• schema input/output
• permission tagging
• timeout policy
• side-effect classification

Lợi

• orchestration agent dễ quyết định hơn
• guardrail dễ viết hơn
• thêm/bớt tool không phá hệ thống

───

4) Command graph / task graph thay vì chỉ prompt-loop

Một hệ tốt không chỉ dựa vào model “tự nghĩ hết”.
Nó nên có graph/intent layer.

Ví dụ:

• user asks → classify intent
• map sang workflow/graph
• workflow chọn tool/agent phù hợp
• model chỉ giải bài toán ở từng node

Lợi

• deterministic hơn
• ít fail execution hơn
• hợp cho automation hơn chat thuần

───

5) Trust boundary rõ giữa metadata, user text, system events

Điểm này cực quan trọng.

Nên tách:

• trusted metadata
• untrusted user input
• system events
• automation events
• external content fetched từ web/files

Lợi

• giảm injection
• tránh agent hiểu nhầm dữ liệu
• an toàn hơn cho multi-channel system

───

6) Startup/context builder riêng, không nhét vào prompt thủ công

Các harness tốt thường có bước:

• scan workspace
• build context snapshot
• prefetch lightweight state
• rồi mới vào run loop

nên có một context builder layer riêng cho agent-orchestra.

Ví dụ:

• recent task state
• repo summary
• tool availability
• session memory
• environment facts

Lợi

• prompt ngắn hơn
• state nhất quán hơn
• dễ optimize hơn

───

7) Execution guard ở runtime, không chỉ ở prompt

Đây là điểm tui vừa đau đầu thực tế.

Đừng chỉ dặn trong prompt:

• “phải làm rồi mới nói”

Mà nên có runtime rule như:

• nếu assistant trả lời “I’ll do it / con làm ngay” mà turn không có action/tool → chặn
• nếu task actionable mà model chỉ giải thích → yêu cầu replan/action
• nếu interrupted → resume task lock

Lợi

• giảm failed execution thật
• đúng cái Papa đang cần nhất

───

8) Isolated runs cho automation thay vì phụ thuộc main chat session

Bài học từ stock news rất rõ:

• cron chỉ bơm vào main session là rất mong manh

agent-orchestra nên xem automation là:

• separate execution path
• isolated run
• background worker / independent unit
• main chat chỉ nhận summary hoặc alert

Lợi

• bền hơn
• ít bị chat noise làm trôi task
• phù hợp với cron / watcher / monitors

───

9) Multi-agent phải có role specialization thật

Không nên chỉ spawn “nhiều agent cho vui”.

nên định nghĩa agent role kiểu:

• planner
• executor
• verifier
• researcher
• environment operator
• summarizer

Mỗi role:

• có tool set riêng
• quyền riêng
• output contract riêng

Lợi

• bớt lẫn vai
• dễ kiểm soát chất lượng
• dễ scale orchestration

───

10) Build observability từ đầu

Một harness tốt phải debug được.

agent-orchestra nên có:

• run ids
• tool trace
• timing
• last action
• failure reason
• state snapshots
• per-step logs
• delivery result logs

Lợi

• khi fail không phải đoán
• Papa nhìn log là biết chết ở đâu
• automation ổn định lên rất nhiều

───

# agent-orchestra architecture draft v1

## Goal
Build `agent-orchestra` as a practical multi-agent runtime for real work, not just a chat shell.

Primary goals:
- reliable execution instead of promise-only replies
- isolated automation that does not depend on the main chat session
- clear session/transcript/task state
- strong tool orchestration with observability
- role-based multi-agent coordination

---

## 1. Core architecture layers

### A. Entrypoint layer
Responsible for receiving work from:
- direct user chat
- cron/scheduled jobs
- webhooks/events
- internal follow-up tasks
- sub-agent delegation

Responsibilities:
- normalize inbound requests
- attach trusted metadata
- classify request type
- route into the correct runtime path

Output:
- a `RunRequest`

Example shape:
```ts
RunRequest {
  source: 'chat' | 'cron' | 'webhook' | 'system'
  sessionId: string
  actorId: string
  trustedMeta: object
  userMessage?: string
  systemEvent?: string
  attachments?: Attachment[]
  requestedMode?: 'interactive' | 'automation' | 'background'
}
```

### B. Runtime layer
The heart of the system.

Responsibilities:
- manage run lifecycle
- decide which execution path to use
- maintain task lock / state
- execute turn loop
- enforce execution guardrails
- coordinate sub-agents

Main runtime modes:
- `interactive_run`
- `automation_run`
- `background_run`
- `verification_run`

### C. Tool layer
A registry of tools with:
- schema
- timeout
- safety level
- side-effect category
- allowed roles

Tool classes:
- read-only tools
- local mutation tools
- external action tools
- privileged/elevated tools
- communication tools

### D. Policy layer
A separate layer that decides:
- who is allowed to request what
- what data can be revealed
- what tools are allowed in this context
- whether a reply is allowed without action

This layer must be runtime-enforced, not prompt-only.

---

## 2. Session, transcript, and task state

### Session model
Each session should have:
- `sessionId`
- `sessionType` (`main`, `cron`, `subagent`, `thread`, `background`)
- `owner`
- `channel`
- `activeTaskId?`
- `modelConfig`
- `policyContext`

### Transcript model
Transcript should be structured, not plain concatenated text.

```ts
TranscriptEntry {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  ts: number
  runId?: string
  taskId?: string
  toolName?: string
  trusted: boolean
  content: string | object
}
```

### Task state
A task object must exist independently of the chat transcript.

```ts
TaskState {
  taskId: string
  sessionId: string
  origin: 'user' | 'cron' | 'system'
  status: 'queued' | 'running' | 'blocked' | 'waiting' | 'done' | 'failed'
  title: string
  objective: string
  executionRequired: boolean
  lastActionAt?: number
  lastEvidence?: string
  blocker?: string
  resumeHint?: string
}
```

This is critical for:
- anti-failed-execution
- auto-resume
- auditability
- multi-agent handoff

---

## 3. Execution guard (critical)

This should be a runtime feature, not only a prompt instruction.

### Rule
If a user asks for an actionable task, the assistant should not be allowed to emit a promise-style reply unless the same turn includes one of:
- a real tool call
- an actual plan transition into background execution
- a real blocker requiring user input
- an approval request for a sensitive action

### Guard behavior
If model output says things like:
- “I’ll do it now”
- “Con làm đây”
- “Con kiểm tra ngay”

but no action has happened in the same run:
- reject the response
- force replan
- require one of:
  - tool action
  - blocker explanation
  - permission request

### Evidence-first response mode
Before reply, runtime should check whether there is evidence:
- tool output
- command result
- file read result
- run spawn id
- scheduler confirmation

If none exists and task is actionable:
- reply should be blocked

---

## 4. Automation should be isolated

### Problem to avoid
Do not route cron jobs through the same fragile path as conversational turns.

### Recommended design
Cron/event should create a `background_run` or `automation_run`.

Flow:
1. cron fires
2. runtime creates an isolated run
3. the isolated run executes the script or workflow
4. result is logged
5. optional summary is delivered back to user

### Why
This avoids failures like:
- main chat session not noticing system event
- conversational noise interrupting automation
- timeouts in chat-driven execution

---

## 5. Agent roles

Define specialized roles instead of using generic clones.

### Suggested roles

#### A. Planner
- decomposes tasks
- decides whether to delegate
- does not perform risky actions directly

#### B. Executor
- runs tools
- edits files
- executes commands
- gathers evidence

#### C. Verifier
- checks whether work actually happened
- confirms outputs
- catches failed execution or fake completion

#### D. Researcher
- fetches docs/web info
- synthesizes background
- should be mostly read-only

#### E. Automation operator
- handles cron/background jobs
- optimized for deterministic flows
- low-chatter, high-reliability

---

## 6. Tool registry design

Each tool should declare metadata.

```ts
ToolSpec {
  name: string
  category: 'read' | 'write' | 'exec' | 'external' | 'message'
  mutatesState: boolean
  externalSideEffect: boolean
  requiresApproval: boolean
  allowedRoles: string[]
  timeoutMs: number
}
```

Why this matters:
- planner can choose safe tools first
- policy can block dangerous tools in group/public contexts
- runtime can explain why a tool was denied

---

## 7. Observability and logs

Every run should be inspectable.

### Minimum run record
```ts
RunRecord {
  runId: string
  sessionId: string
  taskId?: string
  source: 'chat' | 'cron' | 'webhook' | 'system'
  startedAt: number
  endedAt?: number
  status: 'ok' | 'blocked' | 'failed' | 'killed'
  model: string
  toolCalls: ToolCallRecord[]
  finalReply?: string
  failureReason?: string
}
```

### Minimum tool call record
```ts
ToolCallRecord {
  name: string
  startedAt: number
  endedAt?: number
  status: 'ok' | 'error' | 'timeout'
  summary?: string
}
```

This is how Papa can debug:
- why automation failed
- where timeout happened
- whether a promise-only reply was blocked

---

## 8. Context builder

Context should be assembled from structured sources, not manually stuffed into prompt each time.

Context sources:
- current task state
- recent transcript window
- memory summary
- workspace facts
- tool availability
- trusted metadata
- policy flags

Recommended modules:
- `buildInteractiveContext(session)`
- `buildAutomationContext(job)`
- `buildVerificationContext(task)`

---

## 9. Recommended execution paths

### A. Interactive user task
Use when Papa directly asks something.

Flow:
1. create/update `TaskState`
2. classify task
3. choose executor path
4. call tools
5. verify evidence
6. reply

### B. Automation task
Use for cron/watchers.

Flow:
1. create `automation_run`
2. run workflow/script in isolation
3. collect result
4. optionally summarize to Papa

### C. Long-running background task
Use for coding, indexing, heavy batch work.

Flow:
1. spawn background worker/sub-agent
2. store run id + task id
3. keep status visible
4. allow later follow-up

### D. Verification task
Use when another agent claims “done”.

Flow:
1. read changed files or logs
2. confirm evidence
3. only then mark complete

---

## 10. MVP priorities for agent-orchestra

### Phase 1
Build these first:
1. `TaskState` store
2. runtime execution guard
3. structured run logs
4. isolated automation runner
5. simple tool registry

### Phase 2
Then add:
6. sub-agent role system
7. transcript replay/checkpoints
8. planner/executor/verifier split
9. context builder modules
10. workflow graph support

### Phase 3
Then add:
11. GUI/dashboard for runs/tasks
12. richer policy engine
13. reusable workflow packs
14. long-running background supervision

---

## 11. Concrete recommendation for Papa

If Papa only builds three things next, build these:

### 1. Runtime execution guard
This directly attacks the “failed execution” problem.

### 2. Isolated automation runner
This fixes cron/background reliability.

### 3. TaskState + RunRecord
This gives visibility and resumability.

These three create the backbone. Multi-agent sophistication can come after.

---

## 12. One-sentence design philosophy

`agent-orchestra` should behave less like a chat bot and more like a disciplined operations runtime for agent work.
