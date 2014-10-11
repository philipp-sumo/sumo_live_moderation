var Request = require("sdk/request").Request;
var { ToggleButton } = require("sdk/ui/button/toggle");
var tabs = require("sdk/tabs");
var notifications = require("sdk/notifications");
var ss = require("sdk/simple-storage");
var prefs = require("sdk/simple-prefs").prefs;
var liveModeration = 0;

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
		if (state.checked === true){
		ss.storage.mod_enabled = true;
		button.label = "SUMO Live Moderation: on";
		fetchQuestion();
		liveModeration = require('sdk/timers').setInterval(fetchQuestion,PollingTime());		
		console.log("Moderation on");
				}
        else if (state.checked === false){
		ss.storage.mod_enabled = false;
		button.label = "SUMO Live Moderation: off";
		require('sdk/timers').clearInterval(liveModeration);
		console.log("Moderation off");
		}
    }
  });
  
/*set intial state*/
if (ss.storage.mod_enabled === true){
	button.label = "SUMO Live Moderation: on";
	button.checked = true;
	liveModeration = require('sdk/timers').setInterval(fetchQuestion,PollingTime());
	console.log("Moderation on");
}

/*listen for changes to settings*/
require("sdk/simple-prefs").on("", prefsChange);
function prefsChange(Prefname){
	console.log(Prefname + " changed state to: " + require('sdk/simple-prefs').prefs[Prefname]);
	if (ss.storage.mod_enabled === true){
		require('sdk/timers').clearInterval(liveModeration);	
		liveModeration = require('sdk/timers').setInterval(fetchQuestion,PollingTime());
	}
}

/*convert polling interval from seconds to ms & ensure minimal interval is 15s*/
function PollingTime(){
	if (prefs.polling > 15){
		return prefs.polling*1000;
	}
	else{
		return 15000;
	}
}

/*core functionality*/
function fetchQuestion(){
	var questionRequest = Request({
		url: "https://support.mozilla.org/api/2/question/?ordering=-id&format=json&is_spam=False&is_locked=False",
		onComplete: function (response) {
			var latestsumoquestionid = response.json.results[0].id;
			if (ss.storage.lastpage < latestsumoquestionid || !ss.storage.lastpage){
				
				/*start fresh if no prior threads were looked at or they are too out of date*/
				if (!ss.storage.lastpage || latestsumoquestionid - ss.storage.lastpage > 13 ){				
					var sumoquestionid = response.json.results[0].id;
					var sumoquestioncreator = response.json.results[0].creator;
					var sumoquestiontitle = response.json.results[0].title;
					}
				
				/*find the oldest thread not looked at yet and increase id by one*/
				else if (ss.storage.lastpage < latestsumoquestionid && latestsumoquestionid - ss.storage.lastpage < 13 ){
					for(var i = 0; i < response.json.results.length; i++)
					{
					  if(response.json.results[i].id == ss.storage.lastpage)
					  {
						var sumoquestionid = response.json.results[i-1].id;
						var sumoquestioncreator = response.json.results[i-1].creator;
						var sumoquestiontitle = response.json.results[i-1].title;
					  }
					}
				}
							
				console.log("Question now under scrutiny is: " + sumoquestionid);
				var contentRequest = Request({
					url: "https://support.mozilla.org/api/2/question/" + sumoquestionid + "/?format=json",
					onComplete: function (response2) {
						var sumoquestioncontent = response2.json.content;
						var classifyResult = classifyQuestion(response, sumoquestiontitle, sumoquestioncreator, sumoquestioncontent);
						
						/*perform actions based on classification results*/
						if (["spammy keyword","phone number","link","little content","garbled content","possible duplicate"].indexOf(classifyResult) !== -1){
							if (classifyResult = "possible duplicate"){
								duplicatealertexisting(sumoquestioncreator);
							}
							else{
								tabs.open({
								  url: "https://support.mozilla.org/questions/" + sumoquestionid,
								  inBackground: prefs.alertinbackground
								});
							}
							notifications.notify({
							  title: "SUMO: Moderation needed?",
							  text: "contains " + classifyResult,
							  data: "",
							});
						}
						
						else if (classifyResult == "clear" && prefs.verbose === true){
							notifications.notify({
							  title: "SUMO - " + sumoquestioncreator + " posted:",
							  text: sumoquestiontitle,
							  data: "",
							  onClick: function () {
								tabs.open("https://support.mozilla.org/questions/" + sumoquestionid);
							  }
							});
						}
						else{
							console.log("Nothing to do/report here...");
						}				
					}
				});
				contentRequest.get();
				ss.storage.lastpage = sumoquestionid;
				if (ss.storage.lastpage < latestsumoquestionid){ 
					require('sdk/timers').setTimeout(fetchQuestion,5000); 
				}
			}
			
			else if (ss.storage.lastpage == latestsumoquestionid){
				console.log("Question " + latestsumoquestionid + " has already been seen, no action required...");
			}
		}
	});
	questionRequest.get();
}

/*run tests on fetched question & return a result*/
function classifyQuestion(response, sumoquestiontitle, sumoquestioncreator, sumoquestioncontent){
		if (prefs.alertkeyword === true && RegExp("(season|episode)[\\W]?\\d|" + prefs.keywords, "i").test(sumoquestioncontent) === true || prefs.alertkeyword === true && RegExp("(season|episode)[\\W]?\\d|" + prefs.keywords, "i").test(sumoquestiontitle) === true ){
			return "spammy keyword";
		}
		else if (prefs.alertphonenumberlink === true && sumoquestioncontent.search(/\(?\b([0-9O]{3})\)?[-. ]?([0-9O]{3})[-. ]?([0-9O]{4})\b/) != -1 || prefs.alertphonenumberlink === true && sumoquestiontitle.search(/\(?\b([0-9]{3})\)?[-. ]?([0-9]{3})[-. ]?([0-9]{4})\b/) != -1){
			return "phone number";
		}
		else if (prefs.alertphonenumberlink === true && sumoquestioncontent.search(/\b((https?|ftp|file):\/\/)?[a-z0-9]*[.][a-z]*\/[a-z0-9]+/) != -1 && sumoquestioncontent.search(/[:./ \s]mozilla.(org|com)/) == -1 || prefs.alertphonenumberlink === true && sumoquestiontitle.search(/\b((https?|ftp|file):\/\/)?[a-z0-9]*[.][a-z]*\/[a-z0-9]+/) != -1 && sumoquestioncontent.search(/[:./ \s]mozilla.(org|com)/) == -1){
			return "link";
		}
		else if (prefs.alertgarbled === true && sumoquestioncontent.length < 10 || prefs.alertgarbled === true && sumoquestiontitle.length < 10){
			console.log("Little content, question length is " + sumoquestiontitle.length + " & content length is "+ sumoquestioncontent.length);
			return "little content";
		}
		else if (prefs.alertgarbled === true && countchars(sumoquestioncontent) < 6){
			console.log("Garbled content, only " + countchars(sumoquestioncontent) + " different characters used");
			return "garbled content";
		}
		else if (prefs.alertduplicate === true && getCount(response, sumoquestioncreator) > 1){
			console.log("Possible duplicate, user has posted " + getCount(response, sumoquestioncreator) + " times recently");
			return "possible duplicate";
		}
		else { 
			return "clear";
		}
}

/*query for recent posts of a user*/
function getCount(response, sumoquestioncreator) {
	var count = 0;
	for (var i = 0; i < response.json.results.length; i++) {
		if (response.json.results[i].creator == sumoquestioncreator) {
			count++;
		}
	}
	return count;
}

/*testnumber of different characters in a question*/
function countchars(string){
	var uniq = '';
	for (var i = 0; i< string.length; i++) {
		if(uniq.indexOf( string[i] ) == -1){
			uniq += string[i];
		}
	}
	return uniq.length;
}

/*test if a duplicate alert is already exisitng, if yes: releoad, if no: open new one*/
function duplicatealertexisting(sumoquestioncreator){
	for(var i = 0; i < tabs.length; i++){
		var url = require("sdk/url").URL(tabs[i].url);
		if(url.search == "?a=1&asked_by=" + sumoquestioncreator + "&sortby=1&w=2"){
			tabs[i].reload();
			if (prefs.alertinbackground === false){
				tabs[i].activate();
			}
			return true;
		}
		else{
			tabs.open({
				url: "https://support.mozilla.org/en-us/search?a=1&asked_by=" + sumoquestioncreator + "&sortby=1&w=2",
				inBackground: prefs.alertinbackground
			});
			return false;
		}
	}
}