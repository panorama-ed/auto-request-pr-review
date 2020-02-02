const core = require('@actions/core');
const github = require('@actions/github');

const octokit = new github.GitHub(core.getInput('github-token'));
const orgName = core.getInput('organization');
const parentTeam = core.getInput('parent-team');
const issueLabel = core.getInput('label');

const context = github.context;

// This code produces a weighted random selection of team in github to
// assign an issue to. The weight is based on the relative team size to
// the total population.
console.log(`Looking for teams in ${orgName}`);

octokit.
  teams.
  list({org: orgName}).
  then(
    (teamsResponse) => teamsWithParent(teamsResponse.data, parentTeam)
  ).then(
    (teams) => attachAllTeamMembers(orgName, teams)
  ).then(
    (teamsWithMembers) => attachTeamCounts(teamsWithMembers)
  ).then(
    (teamsWithMembersAndCounts) => selectTeam(teamsWithMembersAndCounts)
  ).then(
    (selectedTeam) => assignReviewTeamAndLabel(selectedTeam)
  ).catch(
    (error) => core.setFailed(`Triage failed with: ${error.stack}`)
  );

/**
 * Selects the teams from an array of github team objects that
 * have parent as a property.
 *
 * @param {!Array<Team>} teams Array of github team objects.
 * @param {string} parentTeam The parent team to filter teams by.
 * @return {!Array<Team>} Array of github team objects that pass the filter.
 */
function teamsWithParent(teams, parentTeam) {
  console.log(`Looking for teams with ${parentTeam} as a parent.`);

  return teams.filter(
    team => team.parent != null && team.parent.name == parentTeam
  );
}

/**
 * Calls github to retrieves the team members in all the teams.
 *
 * @param {string} orgName name of the organization.
 * @param {!Array<Team>} teams Array of github team objects.
 * @return {!Promise<memberResponses} Array of promises that result in
 *   an array of teams with the team members.
 */
function attachAllTeamMembers(orgName, teams) {
  console.log(`Attaching members to ${teams.length} teams.`);

  // This builds up a promise that is fulfilled when all the promises within it
  // are fulfilled. So, for each team, we build a promise that retrieves the
  // members of the team, then attaches the response as a new property.
  return Promise.all(
    teams.map(
      (team) => octokit.teams.listMembersInOrg({
        org: orgName,
        team_slug: team.slug
      }).then(
        (response) => {
          // This is a way to do functional programming in javascript. The
          // ... operator is like the ** in Ruby, and then adds a new property -
          // members - to a newly created object.
          return {
            ...team,
            members: response.data
          };
        }
      )
    )
  );
}

/**
 * Accepts an array of team objects. These team objects are expected to have a
 * members property containing user objects. The function attaches two fields:
 * memberCount and cumulativeCount.
 *
 * memberCount is the number of team members in the team - adjusted for team
 *   members that may appear in more than one team in the array.  In those
 *   cases, the number of team members that have appeared in groups earlier in
 *   the array. This is a greedy algorithm - the order of the team array impacts
 *   the result. For example, if TeamMember1 appears in both TeamA and TeamB,
 *   and TeamA occurs before TeamB in the array ([TeamA, TeamB]) then the
 *   adjustment will occur for the count of TeamB. If the order is reversed,
 *   then the adjustment will occur for the count of TeamA.
 *
 * cumulativeCount is the total number of team members counting from the first
 *   team in the teams array forward. This number is used to select teams
 *   proportionate to size. Again, it is dependent on the order of the teams
 *   and re-ordering the array will render the count meaningless.
 *
 * Note that this method currently mutates its inputs.
 *
 * @param {!Array<Team>} teams Array of github team objects with members
 *   property.
 * @return {!Promise} A promise that returns the teams with the additional
 *   attirbutes.
 */
function attachTeamCounts(teams) {
  // Some of the team members appear in more than one team, so this
  // code keeps track of whom we have seen before and adjusts the
  // counts accordingly
  let seenMembers = new Set();
  let cumulativeCount = 0;

  return teams.map(
    (team) => {
      // Compute the number of times people appear in more than one
      // team
      let adjustCount = team.members.reduce(
        (accumulator, teamMember) => {
          if (seenMembers.has(teamMember.login)) {
            accumulator++;
          } else {
            seenMembers.add(teamMember.login);
          }
          return accumulator;
        },
        0
      );

      let memberCount = team.members.length - adjustCount;
      cumulativeCount += memberCount;

      // Keep a running total of the team members. Note, that this
      // implies we cannot reorder the teams array, because then the
      // cumulative counts would be off. This should be fine for the
      // purposes of this script, but if that changes in the future,
      // then this code will need to be adjusted.
      return {
        ...team,
        memberCount: memberCount,
        cumulativeCount: cumulativeCount
      };
    }
  );
}

/**
 * Selects a team from the teams array such that teams with more members
 * get selected relatively more than teams with fewer members.
 *
 * @param {!Array<team>} teams Team objects with memberCount and cumulativeCount
 *   attached.
 * @return {team object} The github team object selected for review.
 */
function selectTeam(teams) {
  // So, now we have a list of teams with member counts. We also have
  // a cumulativeCount on each team. This is going to allow us to
  // weight selection using a uniform random number generator.
  let totalTeamMembers = teams[teams.length - 1].cumulativeCount;
  let selectedCap = Math.floor(totalTeamMembers * Math.random());

  // We now have a selectedCap, and we can iterate through teams
  // until we find a cumulativeCount >= than the cap. When this occurs,
  // this is the team selected
  let selectedTeam = teams.find(
    (team) => team.cumulativeCount >= selectedCap
  );

  console.log(`Selected ${selectedTeam.name}`);
  return selectedTeam;
}

/**
 * Assigns a team to review the PR specified by the global context object. Also
 * labels the PR.
 *
 * @param {team object} selectedTeam A github team object representing the team
 *   selected for assignment.
 */
function assignReviewTeamAndLabel(selectedTeam) {
  let payload = context.payload;

  console.log(`Creating review request for pull request ` +
              `${payload.pull_request.number}`);

  return octokit.pulls.createReviewRequest({
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    pull_number: payload.pull_request.number,
    team_reviewers: [selectedTeam.slug]
  }).then(
    (_reviewRequestResponse) => {
      // Now we add a label to the issue to indicate that it requires QA.
      console.log(`Adding label ${issueLabel} to issue.`);
      return octokit.issues.addLabels({
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        issue_number: payload.pull_request.number,
        labels: [issueLabel]
      });
    }
  );
}
