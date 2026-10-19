//! Property helpers shared by the v-for item generation paths.

use crate::{ElementNode, ElementType, ExpressionNode, PropNode, TemplateChildNode};

use super::{
    generate::generate_single_prop,
    helpers::{get_element_key, has_other_props, should_skip_prop},
};
use crate::codegen::{
    context::CodegenContext,
    element::helpers::is_is_prop,
    props::{
        StaticMerge, duplicate_von_event_keys, generate_merged_event_handlers, get_von_event_key,
    },
};
use crate::steps::v_memo::has_v_memo;
use vize_l0::{FxHashSet, String};

pub(super) enum EventPropAction {
    Single,
    Merged(String),
    Skip,
}

pub(super) fn event_prop_sets(
    ctx: &CodegenContext,
    props: &[PropNode<'_>],
) -> (FxHashSet<String>, FxHashSet<String>) {
    let duplicate_events = if ctx.merge_props {
        duplicate_von_event_keys(props, ctx.props_is_plain_element)
    } else {
        FxHashSet::default()
    };
    (duplicate_events, FxHashSet::default())
}

pub(super) fn event_prop_action(
    ctx: &CodegenContext,
    prop: &PropNode<'_>,
    duplicate_events: &FxHashSet<String>,
    emitted_events: &mut FxHashSet<String>,
) -> EventPropAction {
    let PropNode::Directive(dir) = prop else {
        return EventPropAction::Single;
    };
    let Some(key) = get_von_event_key(dir, ctx.props_is_plain_element) else {
        return EventPropAction::Single;
    };
    if !duplicate_events.contains(&key) {
        return EventPropAction::Single;
    }
    if emitted_events.insert(key.clone()) {
        EventPropAction::Merged(key)
    } else {
        EventPropAction::Skip
    }
}

pub(super) fn generate_event_prop_action(
    ctx: &mut CodegenContext,
    action: EventPropAction,
    prop: &PropNode<'_>,
    props: &[PropNode<'_>],
    static_merge: StaticMerge<'_>,
) {
    match action {
        EventPropAction::Single => generate_single_prop(ctx, prop, static_merge),
        EventPropAction::Merged(key) => generate_merged_event_handlers(ctx, props, &key),
        EventPropAction::Skip => {}
    }
}

pub(super) fn strip_need_patch_for_v_for_item(patch_flag: Option<i32>) -> Option<i32> {
    patch_flag.and_then(|flag| {
        let next = flag & !512;
        (next > 0).then_some(next)
    })
}

pub(super) fn is_for_item_segment_skip_prop(prop: &PropNode<'_>, skip_is_prop: bool) -> bool {
    if should_skip_prop(prop) || (skip_is_prop && is_is_prop(prop)) {
        return true;
    }
    matches!(
        prop,
        PropNode::Directive(dir)
            if dir.arg.is_none() && (dir.name == "bind" || dir.name == "on")
    )
}

pub(super) fn unwrap_template_single_element<'a>(
    el: &'a ElementNode<'a>,
) -> Option<&'a ElementNode<'a>> {
    if el.tag_type != ElementType::Template {
        return None;
    }
    let [TemplateChildNode::Element(child_el)] = el.children.as_slice() else {
        return None;
    };
    (child_el.tag_type == ElementType::Element).then_some(child_el)
}

/// The element a loop item renders and its key. A `<template v-for>` carrying
/// only `v-for` and `key` around one key-less component keys that component as
/// the item vnode instead of a fragment, as Vue's transformFor does.
pub(super) fn for_item_element<'a, 'b>(
    el: &'b ElementNode<'a>,
) -> (&'b ElementNode<'a>, Option<&'b ExpressionNode<'a>>) {
    let key = get_element_key(el);
    if el.tag_type == ElementType::Template
        && !has_other_props(el)
        && !has_v_memo(el)
        && let [TemplateChildNode::Element(child)] = el.children.as_slice()
        && child.tag_type == ElementType::Component
        && get_element_key(child).is_none()
    {
        return (child, key);
    }
    (el, key)
}

pub(super) fn push_null_props_if_missing(ctx: &mut CodegenContext, emitted_props: bool) {
    if !emitted_props {
        ctx.push(", null");
    }
}
