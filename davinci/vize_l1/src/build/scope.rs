//! Structural recovery shared by node construction and live scope consumers.

use vize_l0::{Allocator, Namespace, Vec, is_html_tag, is_math_ml_tag, is_svg_tag};

/// A caller's open-element frame; recovery never owns or copies its payload.
pub(crate) trait Frame<'a> {
    fn tag(&self) -> &'a str;
    fn namespace(&self) -> Namespace;
}

struct Closed<'a> {
    tag: &'a str,
    depth: usize,
}

/// Holds only the redundant-end-tag evidence already needed by the builder.
pub(crate) struct Recovery<'a> {
    closed: Vec<'a, Closed<'a>>,
    repair_interactive: bool,
}

impl<'a> Recovery<'a> {
    pub(crate) fn new(allocator: &'a Allocator, repair_interactive: bool) -> Self {
        Self {
            closed: Vec::new_in(&allocator),
            repair_interactive,
        }
    }

    /// Compute the namespace and first implicitly closed depth. The caller
    /// pops its own frames, preserving node payloads without a second stack.
    pub(crate) fn open<F: Frame<'a>>(
        &mut self,
        stack: &[F],
        tag: &str,
        self_closing: bool,
    ) -> (Namespace, Option<usize>) {
        let ns = namespace(stack, tag);
        let depth =
            (!self_closing && self.repair_interactive && ns == Namespace::Html && interactive(tag))
                .then(|| {
                    stack.iter().rposition(|frame| {
                        frame.namespace() == Namespace::Html
                            && interactive(frame.tag())
                            && frame.tag().eq_ignore_ascii_case(tag)
                    })
                })
                .flatten();
        if let Some(depth) = depth {
            for (depth, frame) in stack.iter().enumerate().skip(depth) {
                self.closed.push(Closed {
                    tag: frame.tag(),
                    depth,
                });
            }
            return (ns, Some(depth));
        }
        // Optional end tags close silently: a later end tag of a closed
        // descendant stays a stray end tag, as in the shipped parser.
        let optional = (!self_closing && self.repair_interactive && ns == Namespace::Html)
            .then(|| optional_end_depth(stack, tag))
            .flatten();
        (ns, optional)
    }

    /// Matching an ancestor also ends descendants; stray and redundant
    /// implicitly closed tags leave the caller's live scope intact.
    pub(crate) fn close<F: Frame<'a>>(&mut self, stack: &[F], tag: &str) -> Option<usize> {
        let matched = stack
            .iter()
            .rposition(|frame| frame.tag().eq_ignore_ascii_case(tag));
        if self.closed.last().is_some_and(|closed| {
            closed.tag.eq_ignore_ascii_case(tag) && matched.is_none_or(|depth| depth < closed.depth)
        }) {
            self.closed.pop();
            return None;
        }
        matched
    }
}

fn namespace<'a, F: Frame<'a>>(stack: &[F], tag: &str) -> Namespace {
    if is_svg_tag(tag) {
        Namespace::Svg
    } else if is_math_ml_tag(tag) {
        Namespace::MathMl
    } else {
        stack
            .last()
            .map_or(Namespace::Html, |frame| match frame.namespace() {
                Namespace::Svg if matches!(frame.tag(), "foreignObject" | "desc" | "title") => {
                    Namespace::Html
                }
                Namespace::MathMl if matches!(frame.tag(), "mi" | "mo" | "mn" | "ms" | "mtext") => {
                    Namespace::Html
                }
                other => other,
            })
    }
}

fn interactive(tag: &str) -> bool {
    (tag.eq_ignore_ascii_case("a") || tag.eq_ignore_ascii_case("button")) && is_html_tag(tag)
}

/// The shipped parser's "in body" optional end tags: a new `li`, `dt`/`dd`,
/// `option` or `optgroup` closes its open namesake, and `p` or a block
/// start tag closes an open `p` in button scope.
fn optional_end_depth<'a, F: Frame<'a>>(stack: &[F], tag: &str) -> Option<usize> {
    let any = |tags: &[&str]| {
        stack
            .iter()
            .rposition(|frame| tree_element(frame) && tag_in(frame.tag(), tags))
    };
    if tag.eq_ignore_ascii_case("li") {
        return scoped(stack, "li", LIST_ITEM_SCOPE);
    }
    if tag_in(tag, &["dt", "dd"]) {
        return any(&["dt", "dd"]);
    }
    if tag.eq_ignore_ascii_case("option") {
        return stack
            .iter()
            .rposition(|frame| frame.tag().eq_ignore_ascii_case("option"));
    }
    if tag.eq_ignore_ascii_case("optgroup") {
        return any(&["option", "optgroup"]);
    }
    if tag_in(tag, CLOSES_P) {
        return scoped(stack, "p", BUTTON_SCOPE);
    }
    None
}

/// The innermost open `target` reachable from the insertion point before a
/// scope boundary or a non-element (component, slot, structural template).
fn scoped<'a, F: Frame<'a>>(stack: &[F], target: &str, boundary: &[&str]) -> Option<usize> {
    for (index, frame) in stack.iter().enumerate().rev() {
        if !tree_element(frame) {
            return None;
        }
        if frame.tag().eq_ignore_ascii_case(target) {
            return Some(index);
        }
        if tag_in(frame.tag(), boundary) {
            return None;
        }
    }
    None
}

fn tree_element<'a, F: Frame<'a>>(frame: &F) -> bool {
    frame.namespace() == Namespace::Html
        && is_html_tag(frame.tag())
        && !frame.tag().eq_ignore_ascii_case("slot")
        && !frame.tag().eq_ignore_ascii_case("component")
}

fn tag_in(tag: &str, tags: &[&str]) -> bool {
    tags.iter()
        .any(|candidate| tag.eq_ignore_ascii_case(candidate))
}

const BUTTON_SCOPE: &[&str] = &[
    "applet", "button", "caption", "html", "table", "td", "th", "marquee", "object", "template",
];

const LIST_ITEM_SCOPE: &[&str] = &[
    "applet", "caption", "html", "table", "td", "th", "marquee", "object", "template", "ol", "ul",
];

const CLOSES_P: &[&str] = &[
    "address",
    "article",
    "aside",
    "blockquote",
    "div",
    "dl",
    "fieldset",
    "footer",
    "form",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "header",
    "hr",
    "main",
    "nav",
    "ol",
    "p",
    "pre",
    "section",
    "table",
    "ul",
];
