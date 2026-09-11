---
layout: base.njk
title: Projects
description: Things Emil builds — hobby OS, retro hardware, electronics, and more.
eleventyNavigation:
  key: Projects
  order: 3
permalink: /projects/
---
<p class="project-intro">Things I build and tinker with. Some are long-running; some are weekend rabbit holes that got out of hand.</p>

<div class="projects">
  {% for project in collections.projects %}
  <div class="project">
    <h3><a href="{{ project.url }}">{{ project.data.title }}</a></h3>
    <p>{{ project.data.summary }}</p>
    <p class="project-meta">{% if project.data.status %}<span class="tag">{{ project.data.status }}</span>{% endif %}{% if project.data.year %}<span class="tag">{{ project.data.year }}</span>{% endif %}</p>
  </div>
  {% endfor %}
</div>
