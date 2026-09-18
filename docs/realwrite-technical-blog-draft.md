# Building RealWrite: An Open-Source Writing Collaboration App For Content Teams

Meta description: I built RealWrite, an open-source writing collaboration app for writers, managers, agencies, and content teams to manage articles, projects, payments, AI checks, plagiarism checks, and reviews in one place.

Suggested slug: `building-realwrite-open-source-writing-collaboration-app`

## The Problem

After writing 1500+ articles that have been published online across various niches such as tech, how-to blogs, automotive, motorsports, health, the food industry, DIY, and more over the span of five years, I started trying to run something of my own.

I started writing when I was in the first year of college. It was something that funded me to have fun and enjoy my college life, but after realizing that I could write my thoughts and people would read them, it became something bigger than that.

I have been a big gearhead throughout my life. I have enjoyed watching cars, trucks, trains, and anything that has an engine in it since my childhood.

When I started writing, I got a chance to write about these things that I practically knew about in detail since I was small. From there, it was plain and simple. I wanted to write.

## From Writing Alone To Managing A Team

Fast forward five years, and I have been trying to juggle my job and my writing with my team of smart writers working for various clients.

It was my first time doing something like this. I started off with a plain Excel sheet, added six or seven columns, and added links to Google Docs. Things worked fine for four or five months, but then it became a hassle remembering payments, the number of articles completed for each month, and keeping track of invoices.

So, taking advantage of what I gave my all to in college, I started working on an app.

The foundation was simple: create a writing collaboration app for my team that would manage clients, projects, articles, payments, messages, reworks, and more.

After three months of continuous development, I had a fully working collaboration tool for my team to use. Writers could log in and submit articles. I could check the articles, run plagiarism tests, run AI detection, read the article, and then approve it. Once approved, it would automatically create a payment request for those writers.

Writers could track their progress for past and present months, and also track payments that were due or paid. Admin accounts could create accounts for managers and writers. Managers could handle big projects together.

## RealWrite Features

RealWrite is built as a writing collaboration app for writers, managers, agencies, and content teams that publish articles on a regular basis.

The main features include:

- Writer login and article submission
- Manager login and article review
- Admin account for creating managers and writers
- Project creation and project management
- Assigning writers to projects
- Article requests with deadlines
- Article editor for writers
- Plagiarism checks
- AI detection checks
- Article approval and rework flow
- Automatic payment request creation after approval
- Writer payment tracking
- Due and paid payment status
- Payment history for writers
- Project spending reports
- Filters for projects and writers
- Messaging between team members
- Manager support for handling bigger projects together
- First-time setup page for creating the first admin account

## The Tech Behind The App

I used Node.js, which has recently become my favorite framework. It is easy to use and implement.

The UI was created using Stitch and then implemented by myself somehow to give the app a modern look with an old British royalty kind of theme and font, with a modern twist.

For the backend, I used Supabase. In the open-source version, anyone can customize the backend according to their needs.

For AI detection, I used a Hugging Face model. For plagiarism, the app can run checks and return a report. APIs are used to authenticate user logins and handle article functions such as submitting an article, checking payment pages, and viewing payment history.

The frontend is very simple, with a basic design and minimal-looking aesthetics so that writers are not distracted from what they are writing.

A dark theme is something I am planning to add later in the future. For now, the writing editor is like plain paper with advanced editing tools for writers to use.

## How The Setup Works

For anyone using the application for the first time, you can set it up on Vercel or your own VPS. You will be taken to a setup page where you can create the first admin account, which will help you set up everything else.

You can then create a manager and let the manager create a project. Writers can be assigned to that project by selecting them from the project settings.

The payment gateways are not connected yet, so you will need to mark the payments as paid once you pay the writers.

The payment page does allow you to see how much you have spent on a project over months, current dates, or weeks. You can also filter between multiple projects or single writers.

## The Hard Part: AI Detection

AI detection is proving to be the hard part.

I have tried everything to include proper AI detection, but the accuracy of even the free use of Copyleaks AI detector is not being matched. I feel like not many people are working on creating an AI text detector, and small models do not exist yet.

However, you can easily tune the code and add your own Copyleaks API keys or another provider in the code to use it.

## Why I Made RealWrite Open Source

After all this, I knew I had prepared an app that was fully thought out, created using the experience I had, and fully built on problem solving.

Creative teams, agencies, or news companies that publish articles on a daily basis can use this app to help them write faster and improve productivity.

You can assign a topic to a writer in urgent cases, and this makes RealWrite better and smarter than everything else available online for this kind of workflow.

The decision in the end was simple. I wanted to let everyone use this so they can also do things faster and more structurally, like me.

You are free to customize and use it according to your needs, and I really hope it helps you solve the problems you are facing.

## Who RealWrite Is For

RealWrite can be useful for:

- Content writing agencies
- Creative teams
- News companies
- Blog publishing teams
- Freelance writing teams
- Managers handling multiple writers
- Small teams that still use Excel sheets and Google Docs to manage articles

If your team publishes articles daily or weekly and needs to manage writers, article submissions, reviews, payments, AI detection, and plagiarism checks in one place, RealWrite is built for that workflow.

## Frequently Asked Questions

### Is RealWrite open source?

Yes, RealWrite is open source and can be customized according to your needs.

### Can RealWrite replace Excel sheets for managing writers?

That was one of the main reasons I built it. I started with an Excel sheet, but once articles, payments, projects, writers, and invoices increased, it became hard to manage everything properly.

### Does RealWrite support AI detection?

Yes, RealWrite supports AI detection, but AI detection is still the hardest part because free models do not match the accuracy of tools like Copyleaks.

### Does RealWrite support plagiarism checking?

Yes, RealWrite includes plagiarism checks and can return a report for submitted articles.

### Can agencies use RealWrite?

Yes, creative teams, writing agencies, and news companies can use RealWrite to manage writers, projects, articles, reviews, and payments more structurally.
