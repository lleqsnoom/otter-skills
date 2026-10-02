# Sketch format

Worked examples. Copy the shape, never the content.

## A logic sketch (single HTML file)

```html
<!-- PROTOTYPE — throwaway. Answers: "does the refund state model allow double refunds?" -->
<h1>Refund state sketch</h1>
<p>State: <output id="state">draft</output></p>
<button onclick="send('approve')">approve</button>
<button onclick="send('refund')">refund</button>
<button onclick="send('cancel')">cancel</button>
<pre id="log"></pre>
<script>
  // Transition table IS the state model under test — every legal move in one place.
  const moves = {
    draft:   { approve: "approved", cancel: "cancelled" },
    approved:{ refund: "refunded" },          // double refund: send('refund') again?
    refunded:{}, cancelled: {}
  };
  let state = "draft";
  function send(action) {
    const next = moves[state][action] ?? illegal(state, action);
    log(`${state} + ${action} -> ${next}`);
    state = next; render();
  }
</script>
```

The whole model sits in one table the user can free-play; the guided walkthroughs are one button per
hard case ("approve then refund then refund again"). If a transition cannot be read in one glance, the
state model — not the sketch — needs work.

## A UI-variants sketch (one route, several variants)

A route like `/sketch/checkout` renders one of three variants, chosen by `?v=1|2|3`, with a floating
bar pinned to the bottom switching between them. Each variant is a whole approach, not a nudge:

- `?v=1` — single page, accordion steps.
- `?v=2` — three screens, progress bar.
- `?v=3` — one screen, order summary beside the form.

State is in-memory; the fetch is a stub returning fixed data; nothing writes to the database. Each
variant renders the same success state, so the user compares the path, not the plumbing.

## Size

If a sketch needs more than one file (logic) or one route (variants), it is two sketches, or it is the
real feature wearing a prototype's name.
