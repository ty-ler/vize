# Current protocol expectations

`scenario.json` selects `initialize-current.json` and `completion-current.json`.
The original `initialize.json` and `completion.json` remain unchanged as the prior
complete vectors. Every other scenario expectation is unchanged.

The current initialization vector includes the source actions required by
`crates/vize_maestro/src/server/capabilities/code_action_tests.rs`, the moniker
provider advertised in `capabilities.rs`, and the JSX checking default defined by
`davinci/vize_l0/src/config/model/defaults.rs`. The fixture now uses canonical
Vite project configuration, so it receives that project default.

The current completion vector retains both original authored candidates first,
then appends the complete independent vector from
`tests/_fixtures/differential/lsp/template-expression-globals-8015/globals.expected.json`.
`crates/vize_maestro/src/ide/completion/template/globals.rs` documents the Vue
instance members and Vue expression global allowlist. No candidates or fields
are removed from the protocol comparison.

All fields in these two current vectors matched the recorded Neovim, Zed, and
VS Code responses in [Editor conformance run 38936651085](https://github.com/ubugeeei-prod/vize/actions/runs/38936651085)
at commit `37be818f1699a83675a79a6d35056f70ce9c13f8`. This records verified current
behavior; it does not establish the result of running the prior fixture on main.
The judge still compares complete responses and rejects every corrupted scenario
expectation, including an absent, false, or incorrectly typed JSX routing hint.
