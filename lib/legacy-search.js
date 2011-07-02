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
 * The Original Code is Thunderbird Jetpack Support.
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

/**
 * Legacy search support.  This file is currently a "only use if you know
 *  how to do this stuff already and understand what it does and all the
 *  caveats of doing it" kind of thing.
 */

let {Cc,Ci,Cu} = require("chrome");

let impns = {};
Cu.import("resource:///modules/gloda/utils.js", impns);
let GlodaUtils = impns.GlodaUtils;

/**
 *
 */
exports.MsgHdrSlicerDicer = {
  /**
   * Get all of the e-mail addresses associated with the user's accounts.
   *
   * Stolen from gloda.
   */
  _getAccountAddresses: function MsgHdrSlicerDicer_getAccountAddresses() {
    let addresses = [];
    let knownMap = {};

    let msgAccountManager = Cc["@mozilla.org/messenger/account-manager;1"].
                            getService(Ci.nsIMsgAccountManager);
    let numIdentities = msgAccountManager.allIdentities.Count();
    for (let iIdentity = 0; iIdentity < numIdentities; iIdentity++) {
      let msgIdentity = msgAccountManager.allIdentities.GetElementAt(iIdentity)
                                         .QueryInterface(Ci.nsIMsgIdentity);

      let emailAddress = msgIdentity.email;
      let replyTo = msgIdentity.replyTo;

      // find the identities if they exist, flag to create them if they don't
      if (emailAddress) {
        let parsed = GlodaUtils.parseMailAddresses(emailAddress);
        let addr = parsed.addresses[0];
        if (!(addr in knownMap)) {
          addresses.push(addr);
          knownMap[addr] = true;
        }
      }
      if (replyTo) {
        let parsed = GlodaUtils.parseMailAddresses(replyTo);
        let addr = parsed.addresses[0];
        if (!(addr in knownMap)) {
          addresses.push(addr);
          knownMap[addr] = true;
        }
      }
    }

    return [addresses, knownMap];
  },

  /**
   * Given a list of message headers, extract out a list of email addresses
   *  seen in the senders list and a list of people seen in the to/cc/bcc lists.
   *  The lists are de-duplicated within themselves and have absolutely no
   *  ordering.
   *
   * @param aMsgHdrs A JS list of message headers.
   * @param aIgnoreOwnIdentities Should we filter out entries belonging to the
   *     Thunderbird user?
   * @return [list of senders, list of recipients]
   */
  getPeopleFromMessages: function MsgHdrSlicerDicer_getPeopleFromMessages(
    aMsgHdrs, aIgnoreOwnIdentities
  ) {
    let ignoreMap = {};
    if (aIgnoreOwnIdentities) {
      ignoreMap = this._getAccountAddresses()[1];
    }
    function slurp(addrstr, outmap) {
      let parsed = GlodaUtils.parseMailAddresses(addrstr);
      for each (let [, addr] in Iterator(parsed.addresses)) {
        if (!(addr in ignoreMap))
          outmap[addr] = true;
      }
    }
    let senderMap = {}, recipMap = {};
    for each (let [, msgHdr] in Iterator(aMsgHdrs)) {
      slurp(msgHdr.author, senderMap);
      slurp(msgHdr.recipients, recipMap);
      slurp(msgHdr.ccList, recipMap);
      slurp(msgHdr.bccList, recipMap);
    }

    function maptolist(inmap) {
      let olist = [];
      for each (let [addr,] in Iterator(inmap)) {
        olist.push(addr);
      }
      return olist;
    }

    return [maptolist(senderMap), maptolist(recipMap)];
  },

  /**
   * Return a PRTime tuple where the first element is the earliest PRTime
   *  found and the second is the newest PRTime found.
   */
  getDateRangeFromMessages: function MsgHdrSlicerDicer_getDateRange(aMsgHdrs) {
    let mindate = aMsgHdrs[0].date;
    let maxdate = mindate;
    for each (let [, msgHdr] in Iterator(aMsgHdrs)) {
      let d = msgHdr.date;
      if (d < mindate)
        mindate = d;
      if (d > maxdate)
        maxdate = d;
    }
    return [mindate, maxdate];
  },
};

function TermMaker(aTermCreator, aOutputList) {
  this._creator = aTermCreator;
  this._outTerms = aOutputList;

  this._inGroup = false;
  this._markNextTermAsBeginsGrouping = false;
  this._lastTerm = null;
}
TermMaker.prototype = {
  beginGroup: function TermMaker_beginGroup() {
    this._markNextTermAsBeginsGrouping = true;
    this._inGroup = true;
  },

  endGroup: function TermMaker_endGroup() {
    if (this._lastTerm)
      this._lastTerm.endsGrouping = true;
    this._markNextTermAsBeginsGrouping = false;
    this._inGroup = false;
  },

  _appendTerm: function TermMarker__appendTerm(aTerm) {
    if (this._markNextTermAsBeginsGrouping) {
      aTerm.beginsGrouping = true;
      this._markNextTermAsBeginsGrouping = false;
    }
    this._outTerms.push(aTerm);
    this._lastTerm = aTerm;
  },

  /**
   * Groupable search for e-mail addresses.
   */
  peopleSearch: function TermMaker_peopleSearch(aMailAddresses,
                                                aCheckSender,
                                                aCheckRecipients) {
    if (!aCheckSender && !aCheckRecipients)
      return;

    for each (let [, addr] in Iterator(aMailAddresses)) {
      let term = this._creator.createTerm();
      if (aCheckSender && aCheckRecipients)
        term.attrib = Ci.nsMsgSearchAttrib.AllAddresses;
      else if (aCheckSender)
        term.attrib = Ci.nsMsgSearchAttrib.Sender;
      else // aCheckRecipients
        term.attrib = Ci.nsMsgSearchAttrib.ToOrCC;

      let value = term.value;
      value.attrib = term.attrib;
      value.str = addr;
      term.value = value;
      term.op = Ci.nsMsgSearchOp.Contains;
      // AND outside groups, OR inside groups.
      term.booleanAnd = !this._inGroup;
      this._appendTerm(term);
    }
  },

  _timeCommon: function TermMaker__timeCommon(aDate, aDelta) {
    let term = this._creator.createTerm();
    term.attrib = Ci.nsMsgSearchAttrib.Date;
    let value = term.value;
    value.attrib = term.attrib;
    value.date = aDate;
    term.value = value;
    if (aDelta == -1)
      term.op = Ci.nsMsgSearchOp.IsBefore;
    else if (aDelta == 0)
      term.op = Ci.nsMsgSearchOp.Is;
    else if (aDelta == 1)
      term.op = Ci.nsMsgSearchOp.IsAfter;
    // time ranges are always AND for now, yo.
    term.booleanAnd = true;
    this._appendTerm(term);
  },

  /**
   * Non-groupable ranged time query.  It only makes sense to use this once
   * in a given query because of filter limitations.
   *
   * @param aWhen A single PRTime or a tuple containing describing a range.
   * @param aAroundRange The number of microseconds into the future and past of
   *     aWhen to look.  Microseconds is the unit of PRTime.
   */
  timeAround: function TermMaker_timeAround(aWhen, aAroundRange) {
    if (this._inGroup)
      throw new Error("timeAround makes its own group; can't be in a group!");

    if (typeof(aWhen) == "number")
      aWhen = [aWhen, aWhen];

    this.beginGroup();
    this._timeCommon(aWhen[0] - aAroundRange, 1);
    this._timeCommon(aWhen[1] + aAroundRange, -1);
    this.endGroup();
  }
};
exports.TermMaker = TermMaker;
