# BlezeX Connect

Build a complete internal CRM and Sales Operations Platform for BlezeX.

The application should look and feel like a modern SaaS product similar to HubSpot CRM, Zoho CRM, ClickUp, and Notion.

The platform is intended for internal company use only.

Company

Company Name

BlezeX

Services

IT Solutions

Custom Software Development

Web Application Development

SaaS Development

AI Solutions

Automation Solutions

CRM Development

Mobile App Development

Business Websites

Cloud Solutions

Graphic Design

Logo Design

Brand Identity

Social Media Creatives

Brochures

Marketing Materials

Presentations

Digital Marketing

SEO

Social Media Marketing

Lead Generation

Performance Marketing

Email Marketing

Content Creation

Website Content

Social Media Content

Blog Writing

Marketing Content

Video Content Planning

Primary Objective

Manage the complete lifecycle:

Lead Generation
→ Lead Qualification
→ Follow-up
→ Meeting
→ Proposal
→ Negotiation
→ Client Conversion
→ Project Execution
→ Payment Tracking
→ Client Retention

Team Structure

The system will be used by exactly 4 users.

Admin Users

surya.blezex@gmail.com

durga.blezex@gmail.com

Role: Admin

Password:

Blezex@admin

Team Members

hemalatha.blezex@gmail.com

team.blezex@gmail.com

Role: Team Member

Password:

Blezex@operations

Authentication Requirements

No signup

No registration

No forgot password

No public access

No user creation

Create a login page with:

Email

Password

Validate against the fixed users listed above.

If credentials do not match:

Show:
"Unauthorized Access"

Store session locally and keep user logged in until logout.

Display logged-in email and role badge in the application header.

Data Storage

Do not use:

Supabase

Firebase

PostgreSQL

MySQL

MongoDB

Use Google Sheets as the shared data source.

Create these sheets:

Leads

Clients

Activities

Tasks

Settings

All users should see the same data.

Admins must immediately see updates made by Team Members.

Permissions

Admin

Can:

View all data

Create records

Edit records

Delete records

Assign leads

Assign tasks

Access reports

Access analytics

Access settings

View team performance

Team Member

Can:

Create leads

Update assigned leads

Add activities

Update lead status

Complete assigned tasks

Cannot:

Delete records

Access reports

Access analytics

Access settings

Design Requirements

Create a modern SaaS dashboard.

Style:

Clean

Professional

Minimal

Fast

Responsive

Color Palette:

Primary: #2563EB
Success: #22C55E
Warning: #F59E0B
Danger: #EF4444
Background: #F8FAFC

Navigation

Left Sidebar:

Dashboard

Leads

Clients

Activities

Tasks

Reports

Settings

Reports and Settings should only be visible to Admins.

Top Header:

User Email

Role Badge

Notifications

Logout

Dashboard Module

Create KPI Cards:

Total Leads

New Leads

Contacted Leads

Meetings Scheduled

Proposals Sent

Negotiations

Converted Clients

Lost Leads

Conversion Rate

Total Pipeline Value

Revenue Closed

Pending Payments

Charts:

Leads by Status

Leads by Source

Monthly Conversions

Revenue Trend

Team Performance

Widgets:

Recent Activities

Upcoming Follow-ups

Pending Tasks

Pending Payments

Leads Module

Provide:

Table View

Kanban View

Fields:

Lead ID

Company Name

Contact Person

Phone Number

Email Address

Service Requirement

Lead Source

Assigned To

Priority

Status

Last Follow-up Date

Next Follow-up Date

Expected Deal Value

Probability %

Expected Closing Date

Notes

Created By

Created Date

Last Updated By

Last Updated Date

Lead Status:

New Lead

Contacted

Meeting Scheduled

Proposal Sent

Negotiation

Converted Client

Lost

On Hold

Priority:

High

Medium

Low

Features:

Add Lead

Edit Lead

Delete Lead (Admin Only)

Assign Lead

Search

Filters

Sorting

Export CSV

Quick Status Updates

Kanban Stages:

New Lead

Contacted

Meeting Scheduled

Proposal Sent

Negotiation

Converted Client

Lost

Allow drag-and-drop movement.

Clients Module

When a lead becomes "Converted Client", allow conversion into a Client.

Fields:

Client ID

Company Name

Contact Person

Phone Number

Email Address

Service Purchased

Project Value

Account Manager

Start Date

Completion Date

Project Status

Payment Status

Amount Paid

Balance Amount

Notes

Created By

Created Date

Project Status:

Onboarding

In Progress

Waiting for Client

Completed

Maintenance

Renewal Due

Payment Status:

Pending

Partial

Paid

Features:

Client Profile

Project Tracking

Payment Tracking

Service History

Activities Module

Track all communications.

Fields:

Activity ID

Date

Company

Contact Person

Activity Type

Discussion Summary

Outcome

Next Action

Next Follow-up Date

Owner

Created By

Activity Types:

Call

WhatsApp

Email

Meeting

Demo

Proposal Discussion

Follow-up

Client Review

Views:

Timeline View

Table View

Tasks Module

Fields:

Task ID

Task Title

Description

Assigned To

Priority

Due Date

Status

Created By

Created Date

Status:

To Do

In Progress

Completed

Features:

Create Task

Assign Task

Mark Complete

View My Tasks

Overdue Alerts

Reports Module (Admin Only)

Create:

Leads by Team Member

Activities by Team Member

Task Completion by Team Member

Conversion Rate by Team Member

Revenue Report

Lead Source Performance

Monthly Growth Report

Lost Leads Analysis

Display with KPI cards and charts.

Notifications

Create alerts for:

Follow-ups Due Today

Overdue Follow-ups

Upcoming Meetings

Pending Tasks

Pending Payments

Audit Tracking

Every Lead, Client, Activity, and Task must automatically store:

Created By

Created Date

Last Updated By

Last Updated Date

Admins should have a Team Performance Dashboard showing:

Leads Created by User

Activities Logged by User

Tasks Completed by User

Client Conversions by User

Final Goal

Build a professional CRM platform for BlezeX that:

Uses Google Sheets as the shared storage layer

Supports exactly 2 Admins and 2 Team Members

Has role-based access control

Tracks leads, clients, activities, tasks, and follow-ups

Provides complete visibility to Admins

Provides a clean and efficient workflow for Team Members

Is responsive and production-ready

Can be deployed immediately and used by the BlezeX team

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/1a671a5d-726d-436c-aa4e-f52e7ab705e7).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
