controls_failed=0
cargo test --locked --profile ci -p vize_canon --lib -- --nocapture || controls_failed=1
for filter in \
  batch::virtual_project::tsconfig_gen::compiler_options \
  batch::virtual_project::project::construction \
  batch::virtual_project::project::registration::inferred::tests \
  batch::virtual_project::typed_router::config_tests \
  batch::virtual_project::package_source_index \
  batch::virtual_project::dependency_scan::consumed_tests \
  batch::virtual_project::editor_projection::consumed_tests \
  corsa_bridge::vue_dependencies_alias::context \
  package_route::stamp; do
  cargo test --locked --profile ci -p vize_canon --lib "$filter" -- --nocapture || controls_failed=1
done
test "$controls_failed" -eq 0
