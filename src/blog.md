---
title: Blog
layout: base.njk
description: Writing from Emil Friðriksson.
eleventyNavigation:
  key: Blog
  order: 3
permalink: /blog/
---
{% if collections.posts.length > 0 %}
<ul class="post-list">
  {% for post in collections.posts %}
  <li>
    <time datetime="{{ post.date | dateToISO }}">{{ post.date | readableDate }}</time>
    <a href="{{ post.url }}">{{ post.data.title }}</a>
  </li>
  {% endfor %}
</ul>
{% else %}
<p>Nothing here yet — first post coming soon.</p>
{% endif %}
