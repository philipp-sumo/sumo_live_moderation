var notifications = require("sdk/notifications");
var prefs = require("sdk/simple-prefs").prefs;
var Request = require("sdk/request").Request;
var ss = require("sdk/simple-storage");
var tabs = require("sdk/tabs");
var ToggleButton = require("sdk/ui/button/toggle").ToggleButton;

var liveModeration;

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
            var sumoquestionid, sumoquestioncreator, sumoquestiontitle;

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
                            break cyclethrough_questions;
                        }
                    }
                }
                /*start fresh if no prior threads were looked at or they are too out of date*/
                else {
                    sumoquestionid = response.json.results[0].id;
                    sumoquestioncreator = response.json.results[0].creator.username;
                    sumoquestiontitle = response.json.results[0].title;
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
                                data: "",
                            });
                        }

                        else if (classifyResult == "clear" && prefs.verbose === true) {
                            notifications.notify({
                                title: "SUMO - " + sumoquestioncreator + " posted:",
                                text: sumoquestiontitle,
                                data: "",
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
                var trustedcontributors = ["cor-el", "fredmcd-hotmail", "jscher2000", "rmcguigan", "MattAuSupport", "the-edmeister", "philipp", "christ1", "Toad-Hall", "Airmail", "Zenos", "James", "Tylerdowner", "iamjayakumars", "CoryMH", "kbrosnan", "MagicFab", "toddy_victor", "ouesten", "John99", "moses", "Sourjobraato_Banerjee", "ideato", "sfhowes", "finitarry", "rjbd", "wsmwk", "bvita2", "Gingerbread_Man", "romsdu81", "feer56", "SuperSluether", "deb.bhattacharya6", "Epicaleb", "alan_r", "imox", "Riyadarefin", "AliceWyman", "Safwan.rahman", "oeekker", "rtanglao", "Maudib11", "DigitalBlade", "Noah_SUMO", "ilixandr", "DeepanshuMoz2017", "villep", "cbaba20", "masterthemachines", "SmartSnail"];
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
                    if (trustedcontributors.indexOf(sumoreplycreator)  !== -1) {
                        console.log("Skipping reply " + sumoreplyid + ", since " + sumoreplycreator + " is trusted");
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
    else if (prefs.alertphonenumberlink === true && sumoreplycontent.search(/\(?\b([0-9O]{3})\)?[-. ]?([0-9O]{3})[-. ]?([0-9O]{4})\b/) != -1 && sumoquestioncontent.search(/((Install|Crash|Startup)Time)|lastMaintenance/) == -1) {
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
        if (response.json.results[i].creator == sumoquestioncreator) {
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
