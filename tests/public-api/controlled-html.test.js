import assert from 'node:assert/strict';
import test from 'node:test';

import { sanitizeControlledHtml } from '../../modules/public-api/controlled-html.js';

test('controlled HTML preserves declared structural and action markup', () => {
    const sanitized = sanitizeControlledHtml(
        '<section><button data-action="feed.like" data-field="postId" value="p1">赞</button></section>',
        '\n.feed { color: red; }\n',
    );

    assert.match(sanitized.html, /<section><button data-action="feed.like" data-field="postId" value="p1">赞<\/button><\/section>/);
    assert.match(sanitized.styles, /^\[data-yuzi-controlled-scene="[a-z0-9-]+"\] \.feed \{/);
});

for (const [name, html] of [
    ['script element', '<section><script>alert(1)</script></section>'],
    ['inline event attribute', '<button onclick="alert(1)">bad</button>'],
    ['javascript URL', '<a href="javascript:alert(1)">bad</a>'],
    ['remote resource', '<img src="https://example.test/image.png">'],
    ['style element', '<style>.bad { color: red; }</style>'],
]) {
    test(`controlled HTML rejects dangerous ${name}`, () => {
        assert.throws(
            () => sanitizeControlledHtml(html),
            (error) => error?.code === 'YUZI_CONTROLLED_HTML_REJECTED',
        );
    });
}
