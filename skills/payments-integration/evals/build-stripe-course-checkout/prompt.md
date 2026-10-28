---
tags: [skill-creator]
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

I have a Next.js 15 app router project with Prisma and Postgres where people buy courses (one time payment, not subscription). Courses have a priceCents column. Add Stripe so a logged in user can buy a course and get access to it after paying. Just write the files into this folder - prisma schema changes, the API routes and whatever else is needed. We sell to customers in the US and Europe so some will pay with SEPA or other bank methods.
