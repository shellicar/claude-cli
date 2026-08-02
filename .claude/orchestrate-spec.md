# Orchestrate: the specification, as tests

Three scopes, each with its own seam. Nothing below a scope's seam is real inside it.

| Scope | Under test | Everything else |
|---|---|---|
| Engine | what a run does with stages | fake tools that answer for themselves |
| Program | turning an executor's answer into a stage's | `FakeExecutor` |
| Executor | closing a pipe becoming a real kill | real processes |

## Engine, with fake tools

A stage's outcome. One per stage, and each test says what the stage produced, what the report
says, and what the stages after it did.

1. A stage runs to the end and its tool calls it done.
2. A stage runs to the end and its tool calls it a failure.
3. A stage is ended by a signal its tool reports.
4. A stage is refused before it runs.
5. A stage never starts, because the one before it failed.
6. A stage never starts, because the one before it was refused.
7. A stage is stopped for producing more than can be held.
8. A stage throws.
9. The call is cancelled while a stage is running.

Bytes between stages.

10. What one stage produces is what the next receives, byte for byte.
11. Nothing between stages interprets those bytes: no separator, encoding or size is assumed.
12. A producer runs ahead of a stalled reader by one buffer and no more.
13. Adding a stage adds a fixed amount to that, not a multiple.
14. A producer whose reader has gone is told to stop, and so is one two stages back.
15. A producer that never ends still terminates the call.

Joining stages.

16. `&&` runs the next stage only when the previous one succeeded.
17. `||` runs it only when the previous one failed.
18. `;` runs it whatever happened.
19. `|` gives the next stage the previous one's bytes.
20. A refusal counts as a failure for 16 and 17.

Xargs.

21. The engine puts an Xargs stage's output into the next tool's declared field.
22. What that field already held is kept, and the new values follow.
23. A sequence where Xargs feeds a tool with no such field is refused before anything runs.
24. An Xargs output larger than can be held stops the producer, and the stage it fed does not run.

What is held.

25. A batch shown for approval is bounded; reaching the bound refuses rather than showing part of it.
26. The run's own result is bounded; reaching it stops the producer and the report says so.

Judging.

27. Every stage is put to the decision, including one that touches nothing.
28. A stage is judged on what it will really do, after its variables are resolved.
29. What is published for approval is what the caller wrote.

## Xargs, as a tool on its own

30. It splits what it reads into one argument per line.
31. A trailing separator does not produce an empty argument.
32. Bytes with no separator in them are one argument.

## Program, with a fake executor

33. An executor reporting exit code zero is a stage that succeeded.
34. An executor reporting a non-zero exit code is a stage that failed.
35. An executor reporting a signal is a stage ended by that signal.
36. The process's bytes are the stage's bytes, unchanged.
37. What was piped in reaches the process's input, unchanged.
38. Closing the stage's output asks the executor to stop the process.
39. A stage is not answered for until the executor says the process is finished with.

## Executor, with real processes

40. Closing the read end of a running process's output kills it with SIGPIPE.
41. A process that ignores that is killed anyway.
42. A process that ends on its own reports its own exit code.
43. Nothing is left running once a run is over.

## Captures, engine with a fake executor

44. A capture holds the stage's whole output.
45. It reaches a later command through the environment that command runs under.
46. It never appears in what is published for approval.
