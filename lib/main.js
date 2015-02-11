var notifications = require("sdk/notifications");
var prefs = require("sdk/simple-prefs").prefs;
var Request = require("sdk/request").Request;
var self = require("sdk/self");
var ss = require("sdk/simple-storage");
var tabs = require("sdk/tabs");
var ToggleButton = require("sdk/ui/button/toggle").ToggleButton;

var liveModeration;
if (!ss.storage.trustedcontributors){
    ss.storage.trustedcontributors = [];
}

/*toggle button*/
var button = ToggleButton({
    id: "sumo-live-mod-button",
    label: "SUMO Live Moderation",
    icon: {
        "16": "./icon-16.png",
        "32": "./icon-32.png",
        "64": "./icon-64.png"
    },
    onChange: function(state) {
        if (state.checked === true) {
            prefs.mod_enabled = true;
            button.label = "SUMO Live Moderation: on";
            fetchQuestion();
            fetchReply();
            liveModeration = require('sdk/timers').setInterval(function(){
                fetchQuestion();
                fetchReply();
            }, PollingTime());
            console.log("Moderation on");
        }
        else if (state.checked === false) {
            prefs.mod_enabled = false;
            button.label = "SUMO Live Moderation: off";
            require('sdk/timers').clearInterval(liveModeration);
            console.log("Moderation off");
        }
    }
});

/*set intial state*/
if (prefs.mod_enabled === false) {
    button.label = "SUMO Live Moderation: off";
    button.checked = false;
}
else {
    prefs.mod_enabled = true;
    button.label = "SUMO Live Moderation: on";
    button.checked = true;
    liveModeration = require('sdk/timers').setInterval(function(){
        fetchQuestion();
        fetchReply();
    }, PollingTime());
    console.log("Moderation on");
}

/*listen for changes to settings*/
require("sdk/simple-prefs").on("", prefsChange);

function prefsChange(Prefname) {
    console.log(Prefname + " changed state to: " + require('sdk/simple-prefs').prefs[Prefname]);
    if (prefs.mod_enabled === true) {
        require('sdk/timers').clearInterval(liveModeration);
        liveModeration = require('sdk/timers').setInterval(function(){
            fetchQuestion();
            fetchReply();
        }, PollingTime());
    }
}

/*convert polling interval from seconds to ms & ensure minimal interval is 15s*/
function PollingTime() {
    if (prefs.polling > 15) {
        return prefs.polling * 1000;
    }
    else {
        return 15000;
    }
}

/*core functionality*/
function fetchQuestion() {
    var questionRequest = Request({
        url: "https://support.mozilla.org/api/2/question/?format=json&ordering=-id&is_spam=False&is_locked=False",
        onComplete: function(response) {
        var latestsumoquestionid = response.json.results[0].id;
            var sumoquestionid, sumoquestioncreator, sumoquestiontitle, sumoquestionproduct;

            if (ss.storage.lastpage == latestsumoquestionid) {
                console.log("Question " + latestsumoquestionid + " has already been seen, no action required...");
            }

            else if (latestsumoquestionid === undefined) {
                console.log("Last known question was " + ss.storage.lastpage + ". Couldn't fetch update now, try again later...");
            }
            
            else if (ss.storage.lastpage > latestsumoquestionid) {
                console.log("timewarp - waiting for future questions to catch up with the past present");
            }
            
            else {
                /*find the oldest thread not looked at yet and increase id by one*/
                if (ss.storage.lastpage < latestsumoquestionid && latestsumoquestionid - ss.storage.lastpage < 15) {
                    cyclethrough_questions:
                    for (var i = latestsumoquestionid - ss.storage.lastpage; i >= 0; i--) {
                        if (response.json.results[i].id > ss.storage.lastpage) {
                            sumoquestionid = response.json.results[i].id;
                            sumoquestioncreator = response.json.results[i].creator.username;
                            sumoquestiontitle = response.json.results[i].title;
							sumoquestionproduct = response.json.results[i].product;
                            break cyclethrough_questions;
                        }
                    }
                }
                /*start fresh if no prior threads were looked at or they are too out of date*/
                else {
                    sumoquestionid = response.json.results[0].id;
                    sumoquestioncreator = response.json.results[0].creator.username;
                    sumoquestiontitle = response.json.results[0].title;
					sumoquestionproduct = response.json.results[0].product;
                }
                console.log("Question now under scrutiny is: " + sumoquestionid);
                var contentRequest = Request({
                    url: "https://support.mozilla.org/api/2/question/" + sumoquestionid + "/?format=json",
                    onComplete: function(response2) {
                        var sumoquestioncontent = response2.json.content;
                        var classifyResult = classifyQuestion(response, sumoquestiontitle, sumoquestioncreator, sumoquestioncontent);

                        /*perform actions based on classification results*/
                        if (["spammy keyword", "phone number", "link", "little content", "garbled content", "possible duplicate"].indexOf(classifyResult) !== -1) {
							if (classifyResult == "possible duplicate") {
                                duplicateHandler(sumoquestioncreator);
                            }
                            else {
                                tabs.open({
                                    url: "https://support.mozilla.org/questions/" + sumoquestionid,
                                    inBackground: prefs.alertinbackground
                                });
                            }
                            notifications.notify({
                                title: "SUMO: Moderation needed?",
                                text: classifyResult + " in a question by " + sumoquestioncreator,
								iconURL: "data:image/png;base64,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",
                                data: "",
                            });
                        }

                        else if (classifyResult == "clear" && prefs.verbose === true) {
							var icon = self.data.url(sumoquestionproduct + ".png");
							console.log(icon);
							notifications.notify({
                                title: "SUMO - " + sumoquestioncreator + " posted:",
                                text: sumoquestiontitle,
                                data: "",
								iconURL: icon,
                                onClick: function() {
                                    tabs.open("https://support.mozilla.org/questions/" + sumoquestionid);
                                }
                            });
                        }
                        else {
                            console.log("Nothing to do/report here...");
                        }
                    }
                });
                contentRequest.get();
                ss.storage.lastpage = sumoquestionid;
                if (ss.storage.lastpage < latestsumoquestionid) {
                    require('sdk/timers').setTimeout(fetchQuestion, 5000);
                }
            }
        }
    });
    questionRequest.get();
}

/*run tests on fetched question & return a result*/
function classifyQuestion(response, sumoquestiontitle, sumoquestioncreator, sumoquestioncontent) {
    if (prefs.alertduplicate === true && getQuestionCount(response, sumoquestioncreator) > 1) {
        console.log("Possible duplicate, user has posted " + getQuestionCount(response, sumoquestioncreator) + " times recently");
        return "possible duplicate";
    }
    else if (prefs.alertkeyword === true && RegExp("(season|episode)[\\W]?\\d|" + prefs.keywords, "i").test(sumoquestioncontent) === true || prefs.alertkeyword === true && RegExp("(season|episode)[\\W]?\\d|" + prefs.keywords, "i").test(sumoquestiontitle) === true) {
        return "spammy keyword";
    }
    else if (prefs.alertphonenumberlink === true && sumoquestioncontent.search(/\(?\b([0-9O]{3})\)?[-. ]?([0-9O]{3})[-. ]?([0-9O]{4})\b/) != -1 && sumoquestioncontent.search(/((Install|Crash|Startup)Time)|lastMaintenance/) == -1|| prefs.alertphonenumberlink === true && sumoquestiontitle.search(/\(?\b([0-9]{3})\)?[-. ]?([0-9]{3})[-. ]?([0-9]{4})\b/) != -1 && sumoquestioncontent.search(/((Install|Crash|Startup)Time)|lastMaintenance/) == -1) {
        return "phone number";
    }
    else if (prefs.alertphonenumberlink === true && sumoquestioncontent.search(/\b((https?|ftp|file):\/\/)?[a-z0-9]*[.][a-z]*\/[a-z0-9]+/) != -1 && sumoquestioncontent.search(/[:./ \s]mozilla(zine)?.(org|com)/) == -1 || prefs.alertphonenumberlink === true && sumoquestiontitle.search(/\b((https?|ftp|file):\/\/)?[a-z0-9]*[.][a-z]*\/[a-z0-9]+/) != -1 && sumoquestioncontent.search(/[:./ \s]mozilla(zine)?.(org|com)/) == -1) {
        return "link";
    }
    else if (prefs.alertgarbled === true && sumoquestioncontent.length < 9 || prefs.alertgarbled === true && sumoquestiontitle.length < 9) {
        console.log("Little content, question length is " + sumoquestiontitle.length + " & content length is " + sumoquestioncontent.length);
        return "little content";
    }
    else if (prefs.alertgarbled === true && getCharacterCount(sumoquestioncontent) < 6) {
        console.log("Garbled content, only " + getCharacterCount(sumoquestioncontent) + " different characters used");
        return "garbled content";
    }
    else {
        return "clear";
    }
}

function fetchReply() {
    if (prefs.checkreplies === true){
        var replyRequest = Request({
            url: "https://support.mozilla.org/api/2/answer/?format=json&ordering=-id",
            onComplete: function(rresponse) {
                var latestsumoreplyid = rresponse.json.results[0].id;
                var sumoreplyid, sumoreplycreator, sumoreplyinquestion;
                
                if (ss.storage.lastreply == latestsumoreplyid) {
                    console.log("Reply " + latestsumoreplyid + " has already been seen, no action required...");
                }

                else if (latestsumoreplyid === undefined) {
                    console.log("Last known reply was " + ss.storage.lastreply + ". Couldn't fetch update now, try again later...");
                }

                else if (ss.storage.lastreply > latestsumoreplyid) {
                    console.log("timewarp - waiting for future replies to catch up with the past present");
                }
                
                else {
                    if (ss.storage.lastreply < latestsumoreplyid && latestsumoreplyid - ss.storage.lastreply < 20) {
                        cyclethrough_replies:
                        for (var i = latestsumoreplyid - ss.storage.lastreply; i >= 0; i--) {
                            if (rresponse.json.results[i].id > ss.storage.lastreply) {
                                sumoreplyid = rresponse.json.results[i].id;
                                sumoreplycreator = rresponse.json.results[i].creator.username;
                                sumoreplyinquestion = rresponse.json.results[i].question;
                                break cyclethrough_replies;
                            }
                        }
                    }
                    else {
                        sumoreplyid = rresponse.json.results[0].id;
                        sumoreplycreator = rresponse.json.results[0].creator.username;
                        sumoreplyinquestion = rresponse.json.results[0].question;
                    }
                    
                    /*skip checks when we know a reply is from a trusted contributor*/
                    if (ss.storage.trustedcontributors.indexOf(sumoreplycreator)  !== -1) {
                        console.log("Skipping reply " + sumoreplyid + ", since " + sumoreplycreator + " is trusted");
                    }
    
                    else {    
                        var userRequest = Request({
                            url: "https://support.mozilla.org/api/2/user/" + sumoreplycreator + "/?format=json",
                            onComplete: function(uresponse) {
                                /*if user has more than 10 soultions add them to whitelist*/
                                if (uresponse.json.solution_count > 10) {
                                    ss.storage.trustedcontributors.push(sumoreplycreator);
                                    console.log("With "+ uresponse.json.solution_count +" solutions " + sumoreplycreator + " will be trusted from now on");
                                }
                                else {
                                    console.log("Reply now under scrutiny is: " + sumoreplyid);
                                    var replyContentRequest = Request({
                                        url: "https://support.mozilla.org/api/2/answer/" + sumoreplyid + "/?format=json",
                                        onComplete: function(rresponse2) {
                                            var sumoreplycontent = rresponse2.json.content;
                                            var classifyResult = classifyReply(sumoreplycontent);

                                            /*perform actions based on classification results*/
                                            if (["spammy keyword", "phone number", "link", "little content", "garbled content"].indexOf(classifyResult) !== -1) {
                                                tabs.open({
                                                    url: "https://support.mozilla.org/questions/" + sumoreplyinquestion + "#answer-" + sumoreplyid,
                                                    inBackground: prefs.alertinbackground
                                                });
                                                notifications.notify({
                                                    title: "SUMO: Moderation needed?",
                                                    text: sumoreplycreator + " replied with " + classifyResult,
                                                    data: "",
                                                });
                                            }
                                            else {
                                                console.log("Nothing to do/report here...");
                                            }
                                        }
                                    });
                                    replyContentRequest.get();
                                }
                            }
                        });
                        userRequest.get();
                    }
                
                    ss.storage.lastreply = sumoreplyid;
                    if (ss.storage.lastreply < latestsumoreplyid) {
                        require('sdk/timers').setTimeout(fetchReply, 5000);
                    }
                }
            }
        });
        replyRequest.get();
    }
}

/*run tests on fetched reply & return a result*/
function classifyReply(sumoreplycontent) {
    if (prefs.alertkeyword === true && RegExp("(season|episode)[\\W]?\\d|" + prefs.keywords, "i").test(sumoreplycontent) === true) {
        return "spammy keyword";
    }
    else if (prefs.alertphonenumberlink === true && sumoreplycontent.search(/\(?\b([0-9O]{3})\)?[-. ]?([0-9O]{3})[-. ]?([0-9O]{4})\b/) != -1 && sumoreplycontent.search(/((Install|Crash|Startup)Time)|lastMaintenance/) == -1) {
        return "phone number";
    }
    else if (prefs.alertphonenumberlink === true && sumoreplycontent.search(/\b((https?|ftp|file):\/\/)?[a-z0-9]*[.][a-z]*\/[a-z0-9]+/) != -1 && sumoreplycontent.search(/[:./ \s]mozilla(zine)?.(org|com)/) == -1) {
        return "link";
    }
    else if (prefs.alertgarbled === true && sumoreplycontent.length < 9) {
        console.log("Little content, reply length is " + sumoreplycontent.length);
        return "little content";
    }
    else if (prefs.alertgarbled === true && getCharacterCount(sumoreplycontent) < 6) {
        console.log("Garbled content, only " + getCharacterCount(sumoreplycontent) + " different characters used");
        return "garbled content";
    }
    else {
        return "clear";
    }
}

/*query for number of recent questions of a particular user*/
function getQuestionCount(response, sumoquestioncreator) {
    var count = 0;
    for (var i = 0; i < response.json.results.length; i++) {
        if (response.json.results[i].creator.username == sumoquestioncreator) {
            count++;
        }
    }
    return count;
}

/*test number of different characters in a question*/
function getCharacterCount(string) {
    var uniq = '';
    for (var i = 0; i < string.length; i++) {
        if (uniq.indexOf(string[i]) == -1) {
            uniq += string[i];
        }
    }
    return uniq.length;
}

/*test if a duplicate alert is already exisitng, if yes: reload, if no: open it in a new tab*/
function duplicateHandler(sumoquestioncreator) {
    var duplicateexisting = 0;
    for (var i = 0; i < tabs.length; i++) {
        var url = require("sdk/url").URL(tabs[i].url);
        if (url.search == "?a=1&asked_by=" + sumoquestioncreator + "&sortby=1&w=2") {
            tabs[i].reload();
            duplicateexisting = 1;
        }
    }
    if (duplicateexisting !== 1) {
        tabs.open({
            url: "https://support.mozilla.org/en-us/search?a=1&asked_by=" + sumoquestioncreator + "&sortby=1&w=2",
            inBackground: prefs.alertinbackground
        });
    }
}

/*check if a user is whitelisted; return "trusted" if yes, return "unknown" if not*/
function evaluateUser(sumoreplycreator) {

}