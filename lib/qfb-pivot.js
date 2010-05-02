/* ***** BEGIN LICENSE BLOCK *****
 *   Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Quick Filter Bar Pivot extension.
 *
 * The Initial Developer of the Original Code is the Mozilla Foundation.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Andrew Sutherland <asutherland@asutherland.org>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

let ls = require("legacy-search");

/**
 * Shallow object copy.
 */
function shallowObjCopy(obj) {
  let newObj = {};
  for each (let [key, value] in Iterator(obj)) {
    newObj[key] = value;
  }
  return newObj;
}

const PRTIME_DAY = 24 * 60 * 60 * 1000 * 1000;
const PRTIME_WEEK = 7 * 24 * 60 * 60 * 1000 * 1000;
const PRTIME_MONTH = 31 * 24 * 60 * 60 * 1000 * 1000;

/**
 * Our
 *
 * {
 *   latched: { // null if we are not latched/active
 *     senders: ["some@email.address"], // always the email address
 *     recipients: ["e@mail.one", "e@mail.two"], // a list of emails
 *     date: [earliestMessageDate, lastMesssageDate], // PRTime
 *   },
 *   states: {
 *     senders: 0, // bitmask, 1 is sender, 2 is receipient
 *     recipients: 0, // same deal
 *     time: 0, // 0 if disabled, otherwise the PRTime delta units...
 *   }
 * }
 *
 * Special notes:
 * - Because we are an extension we need to be a little more careful to check
 *    and handle the case where the state we are passed is null since we are not
 *    guaranteed that we were running in the session that preceded this one.
 */
let PivotFilter = {
  name: "pivot",
  domId: "qfb-pivot",

  /**
   * By default find the people involved...
   */
  getDefaults: function PivotFilter_getDefaults() {
    return {
      latched: null,
      states : {
        senders: 3, recipients: 3, time: 0,
      }
    };
  },

  propagateState: function PivotFilter_propagateState(aOld, aSticky) {
    if (!aOld)
      aOld = this.getDefaults();
    return {
      latched: aSticky ? aOld.latched : null,
      states: shallowObjCopy(aOld.states),
    };
  },

  clearState: function(aState) {
    if (!aState)
      return false;
    let hadState = Boolean(aState.latched);
    aState.latched = null;
    return hadState;
  },

  appendTerms: function PivotFilter_appendTerms(aTermCreator,
                                                aTerms,
                                                aFilterValue) {
    if (!aFilterValue || !aFilterValue.latched)
      return;
    let latched = aFilterValue.latched, states = aFilterValue.states;

    let tmaker = new ls.TermMaker(aTermCreator, aTerms);

    // -- People group
    tmaker.beginGroup();
    if (states.senders)
      tmaker.peopleSearch(latched.senders,
                          states.senders & 1, states.senders & 2);
    if (states.recipients)
      tmaker.peopleSearch(latched.recipients,
                          states.recipients & 1, states.recipients & 2);
    tmaker.endGroup();

    // -- Time group
    if (states.time)
      tmaker.timeAround(latched.date, states.time);
  },

  /**
   * Default behaviour but:
   * - We latch the values from the currently selected messages when activated.
   * - We need to (un)collapse the expando bar as appropriate.
   */
  onCommand: function PivotFilter_onCommand(aState, aNode, aEvent, aDocument) {
    let checked = aNode.checked ? true : null;
    aDocument.getElementById("qfb-pivot-expando-bar").collapsed = !checked;

    if (!aState)
      aState = this.getDefaults();

    if (checked) {
      let folderDisplay = aDocument.defaultView.gFolderDisplay;
      let msgHdrs = folderDisplay.selectedMessages;
      if (msgHdrs.length) {
        let [senders, recipients] =
          ls.MsgHdrSlicerDicer.getPeopleFromMessages(msgHdrs);
        aState.latched = {
          senders: senders,
          recipients: recipients,
          date: ls.MsgHdrSlicerDicer.getDateRangeFromMessages(msgHdrs)
        };
      }
      // Nothing selected means the button won't stick. Surprise!
      else {
        aState.latched = null;
      }
    }
    else {
      aState.latched = null;
    }

    return [aState, true];
  },

  domBindExtra: function PivotFilter_domBindExtra(aDocument, aMuxer, aNode) {
    // -- Expando Buttons!
    function commandHandler(aEvent) {
      let filterValue = aMuxer.getFilterValueForMutation(PivotFilter.name);
      let state = filterValue.states;
      let checked = aEvent.target.checked;
      switch (aEvent.target.id) {
        case "qfb-pivot-sender-sender":
          state.senders = state.senders & ~1 | (checked ? 1 : 0);
          break;
        case "qfb-pivot-sender-recipient":
          state.senders = state.senders & ~2 | (checked ? 2 : 0);
          break;
        case "qfb-pivot-recipients-sender":
          state.recipients = state.recipients & ~1 | (checked ? 1 : 0);
          break;
        case "qfb-pivot-recipients-recipient":
          state.recipients = state.recipients & ~2 | (checked ? 2 : 0);
          break;
        // We work sorta like a radio button except we can be entirely
        //  de-selected.  So just be a checkbox that turns off the other
        //  legal checkboxes.
        case "qfb-pivot-time-day":
          state.time = checked ? PRTIME_DAY : 0;
          aDocument.getElementById("qfb-pivot-time-week").checked = false;
          aDocument.getElementById("qfb-pivot-time-month").checked = false;
          break;
        case "qfb-pivot-time-week":
          state.time = checked ? PRTIME_WEEK : 0;
          aDocument.getElementById("qfb-pivot-time-day").checked = false;
          aDocument.getElementById("qfb-pivot-time-month").checked = false;
          break;
        case "qfb-pivot-time-month":
          state.time = checked ? PRTIME_MONTH : 0;
          aDocument.getElementById("qfb-pivot-time-day").checked = false;
          aDocument.getElementById("qfb-pivot-time-week").checked = false;
          break;
      }
      aMuxer.updateSearch();
    }

    // I guess we could do something with bubbling but it doesn't really
    // matter for this N.
    let clickyButtons = aDocument.getElementById("qfb-pivot-expando-bar")
                                 .getElementsByTagName("toolbarbutton");
    for (let i = 0, n = clickyButtons.length; i < n; i++) {
      clickyButtons[i].addEventListener("command", commandHandler, false);
    }
  },

  reflectInDOM: function PivotFilter_reflectInDOM(aNode, aFilterValue,
                                                  aDocument, aMuxer) {
    let expandoBar = aDocument.getElementById("qfb-pivot-expando-bar");
    if (!aFilterValue) {
      aNode.checked = false;
      expandoBar.collapsed = true;
      return;
    }

    let active = Boolean(aFilterValue.latched);
    let state = aFilterValue.states;

    aDocument.getElementById("qfb-pivot-sender-sender").checked =
      state.senders & 1;
    aDocument.getElementById("qfb-pivot-sender-recipient").checked =
      state.senders & 2;
    aDocument.getElementById("qfb-pivot-recipients-sender").checked =
      state.recipients & 1;
    aDocument.getElementById("qfb-pivot-recipients-recipient").checked =
      state.recipients & 2;

    aDocument.getElementById("qfb-pivot-time-day").checked =
      state.time == PRTIME_DAY;
    aDocument.getElementById("qfb-pivot-time-week").checked =
      state.time == PRTIME_WEEK;
    aDocument.getElementById("qfb-pivot-time-month").checked =
      state.time == PRTIME_MONTH;

    aNode.checked = active;
    expandoBar.collapsed = !active;
  },
};

let qfm = {};
Cu.import("resource:///modules/quickFilterManager.js", qfm);
qfm.QuickFilterManager.defineFilter(PivotFilter);
