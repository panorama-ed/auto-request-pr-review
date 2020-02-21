# Triage Review to Team

This is a github workflow action that will proportionally assign a pull request
review request to a team in an organization.

For example, let us say that our organization has an Engineering team. And
underneath that, there are 3 teams.

    Engineering
    |- Team A (6 members)
    |- Team B (3 members)
    |- Team C (3 members)

This action will automatically request reviews for PRs as they are opened. It
will request reviews from members of Team A at twice the rate of Team B and Team
C. In this way, an automatic way of distributing PRs fairly is enabled.

## Inputs

### `github-token`

**Required** The token to access the github API with.

### `label`

A label to apply to the issue. Defaults to `"Needs QA"`.

### `organization`

Name of the organization to look for teams in. Defaults to `"panorama-ed"`.


### `parent-team`

Name of the parent team from which to draw the teams for review
assignment. Defaults to `"Engineering"`.

## Outputs

None

## Example usage:

This action was built to support a process flow at Panorama where each team is
responsible for reviewing a certain number of dependabot PRs each week. This
action can theoretically be used for any PRs at an organization, but this is how
we use it at Panorama.

    name: Request reviews from Engineering teams at Panorama

    on:
      pull_request:
        types: [opened]

    jobs:
      dependabot-triage:
        runs-on: ubuntu-latest
        if: (github.actor == 'dependabot[bot]' || github.actor == 'dependabot-preview[bot]')

        steps:
          - name: Assign to squad for review
            uses: panorama-ed/triage-review-to-team@master
            with:
              github-token: ${{secrets.PANORAMA_BOT_TOKEN}}

              # The following are all optional
              label: 'Needs QA'
              organization: 'panorama-ed'
              parent-team: 'Engineering'
